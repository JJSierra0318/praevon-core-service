import { BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions } from "@azure/storage-blob";
import { AzureLogger } from "./azureLogger.js";
import { PrismaClient, DocumentType, DocumentStatus } from "../generated/prisma/index.js";
import { v4 as uuidv4 } from "uuid";
import path from 'path';

import dotenv from "dotenv";
dotenv.config();

const prisma = new PrismaClient();

// --- Azure Blob Storage configuration ---

const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME || "your_AZURE_STORAGE_ACCOUNT_NAME";
const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY || "your_AZURE_STORAGE_ACCOUNT_KEY";
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || "documents";

if (!accountName  || !accountKey || !containerName) {
  throw new Error("Azure Storage credentials must be fully provided in environment variables.");
}

const sharedKeyCredential = new StorageSharedKeyCredential(
  accountName,
  accountKey
);

const blobServiceClient = new BlobServiceClient(
  `https://${accountName}.blob.core.windows.net`,
  sharedKeyCredential
);

const containerClient = blobServiceClient.getContainerClient(containerName);

// --- Business Rules ---

const SAS_EXPIRATION_MINUTES = 10; 

// Reglas de negocio (pueden venir de una base de datos en el futuro)
const DOCUMENT_RULES = {
  TENANT_ID_FRONT: { maxSize: 5 * 1024 * 1024, allowedMimes: ['image/jpeg', 'image/png'] },
  TENANT_ID_BACK: { maxSize: 5 * 1024 * 1024, allowedMimes: ['image/jpeg', 'image/png'] },
  TENANT_INCOME_PROOF: { maxSize: 10 * 1024 * 1024, allowedMimes: ['application/pdf'] },
  PROPERTY_PHOTO: { maxSize: 15 * 1024 * 1024, allowedMimes: ['image/jpeg', 'image/png'] },
  PROPERTY_DEED: { maxSize: 20 * 1024 * 1024, allowedMimes: ['application/pdf'] },
};

/**
 * Validates a document request against business rules.
 * @throws {{ status: number, message: string }} If validation fails.
 */
const validateDocumentRequest = (documentType, size, mimeType) => {
  if (!Object.values(DocumentType).includes(documentType)) {
    throw new Error('Invalid document type provided.');
  }

  const rule = DOCUMENT_RULES[documentType];
  if (!rule) throw { status: 400, message: `No validation rules found for document type: ${documentType}` };
  if (size > rule.maxSize) throw { status: 400, message: `File size exceeds the limit of ${rule.maxSize / 1024 / 1024}MB.` };
  if (!rule.allowedMimes.includes(mimeType)) throw { status: 400, message: `Invalid MIME type. Allowed: ${rule.allowedMimes.join(', ')}` };
};


/**
 * Prepares a document upload by creating a DB record and a SAS URL.
 * @param {object} data - The upload preparation data.
 * @param {string} data.originalName - The original filename from the user.
 * @param {string} data.mimeType - The MIME type of the file.
 * @param {number} data.size - The size of the file in bytes.
 * @param {DocumentType} data.type - The business type of the document.
 * @param {number} [data.propertyId] - The optional property ID to associate with.
 * @param {number} data.userId - The ID of the user uploading the file.
 * @returns {Promise<{uploadUrl: string, documentId: number}>} The SAS URL and the new document's ID.
 */
const prepareUpload = async ({ originalName, mimeType, size, type, propertyId = null, userId }) => {
  AzureLogger.info("[prepareUpload] Start", { userId, type, propertyId });
  try {
    validateDocumentRequest(type, size, mimeType);

    // Authorize: check if the user is the owner of the property for property-related documents.
    if (propertyId) {
        const property = await prisma.property.findUnique({ where: { id: parseInt(propertyId) } });
        if (!property) throw { status: 404, message: 'Property not found.' };
        if (property.ownerId !== userId) throw { status: 403, message: 'You are not the owner of this property.' };
    }

    // Create a unique filename and virtual folder path for security and organization.
    const extension = path.extname(originalName);
    const uniqueFileName = `${type.toLowerCase()}/${uuidv4()}${extension}`; 

    const document = await prisma.document.create({
      data: {
        uniqueFileName,
        originalName,
        mimeType,
        size,
        type,
        storageUrl: '', // Will be populated upon confirmation.
        status: DocumentStatus.PENDING_VALIDATION,
        uploadedById: userId,
        propertyId: propertyId ? parseInt(propertyId) : undefined,
      },
    });

    const blockBlobClient = containerClient.getBlockBlobClient(uniqueFileName);

    const sasToken = await generateBlobSASQueryParameters({
      containerName,
      blobName: uniqueFileName,
      permissions: BlobSASPermissions.parse("w"), // Write-only permission
      startsOn: new Date(),
      expiresOn: new Date(new Date().valueOf() + SAS_EXPIRATION_MINUTES  * 60 * 1000), 
      contentType: mimeType,
    }, sharedKeyCredential).toString();

    const uploadUrl = `${blockBlobClient.url}?${sasToken}`;
    AzureLogger.info("[prepareUpload] Success", { userId, documentId: document.id });
    return { uploadUrl, documentId: document.id };
  } catch (err) {
    AzureLogger.error(err, { userId, type, propertyId, operation: "prepareUpload" });
    throw err;
  }
};

/**
 * Confirms a file upload is complete, verifies its existence in storage, and updates the DB record.
 * @param {number} documentId - The ID of the document to confirm.
 * @param {number} userId - The ID of the user who initiated the upload.
 * @returns {Promise<object>} The updated document record.
 */
const confirmUpload = async (documentId, userId) => {
  AzureLogger.info("[confirmUpload] Start", { userId, documentId });
  try {
    const document = await prisma.document.findFirst({
      where: { id: documentId, uploadedById: userId },
    });
    if (!document) throw { status: 404, message: 'Document not found or unauthorized.' };
    
    const blockBlobClient = containerClient.getBlockBlobClient(document.uniqueFileName);
    if (!(await blockBlobClient.exists())) {
      // Clean up orphan DB record if file was never uploaded.
      await prisma.document.delete({ where: { id: documentId } });
      throw { status: 400, message: 'Upload confirmation failed: File not found in storage.' };
    }

    const updated = await prisma.document.update({
      where: { id: documentId },
      data: { storageUrl: blockBlobClient.url },
    });
    AzureLogger.info("[confirmUpload] Success", { userId, documentId });
    return updated;
  } catch (err) {
    AzureLogger.error(err, { userId, documentId, operation: "confirmUpload" });
    throw err;
  }
};

/**
 * Updates the review status of a document.
 * @param {number} documentId - The ID of the document to review.
 * @param {DocumentStatus} newStatus - The new status ('APPROVED' or 'REJECTED').
 * @param {number} reviewingUserId - The ID of the user performing the review.
 * @returns {Promise<object>} The updated document record.
 */
const reviewDocument = async (documentId, newStatus, reviewingUserId) => {
  AzureLogger.info("[reviewDocument] Start", { reviewingUserId, documentId, newStatus });
  try {
    if (!Object.values(DocumentStatus).includes(newStatus)) {
      throw { status: 400, message: 'Invalid document status.' };
    }

    const document = await prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { 
        property: true, // Incluimos la propiedad si está asociada
        uploadedBy: true, // Incluimos al usuario que subió el doc
      },
    });

    // Authorization Logic: determines if the reviewer has permission.
    let isAuthorized = false;

    // Case 1: The reviewer is the owner of the property linked to the document.
    if (document.propertyId) {
      if (document.property.ownerId === reviewingUserId) {
        isAuthorized = true;
      }
    } 
    // Case 2: The document is a tenant's, check for a rental application link.
    else {
      const rentalApplication = await prisma.rental.findFirst({
        where: {
          renterId: document.uploadedById, // El que subió el doc
          property: {
            ownerId: reviewingUserId, // El que está intentando revisar
          },
        },
      });

      if (rentalApplication) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      throw { status: 403, message: 'You are not authorized to review this document.' };
    }

    const updated = await prisma.document.update({
      where: { id: documentId },
      data: { status: newStatus },
    });
    AzureLogger.info("[reviewDocument] Success", { reviewingUserId, documentId, newStatus });
    return updated;
  } catch (err) {
    AzureLogger.error(err, { reviewingUserId, documentId, newStatus, operation: "reviewDocument" });
    throw err;
  }
};

/**
 * Fetches all documents uploaded by a specific user.
 * @param {number} userId - The ID of the user.
 * @returns {Promise<object[]>} A list of the user's documents.
 */
const getMyDocuments = async (userId) => {
  AzureLogger.info("[getMyDocuments] Start", { userId });
  try {
    const docs = await prisma.document.findMany({
      where: { uploadedById: userId },
      orderBy: { createdAt: 'desc' },
    });
    AzureLogger.info("[getMyDocuments] Success", { userId, count: docs.length });
    return docs;
  } catch (err) {
    AzureLogger.error(err, { userId, operation: "getMyDocuments" });
    throw err;
  }
};

/**
 * Generates a temporary, secure URL to download a document.
 * @param {number} documentId - The ID of the document to download.
 * @param {number} requestingUserId - The ID of the user requesting the download.
 * @returns {Promise<string>} The temporary download URL.
 */
const getDocumentDownloadUrl = async (documentId, requestingUserId) => {
  AzureLogger.info("[getDocumentDownloadUrl] Start", { requestingUserId, documentId });
  try {
    const document = await prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { property: true },
    });

    // Authorization Logic: checks if the requester has permission.
    let isAuthorized = false;

    // Rule 1: The uploader can always access their own document.
    if (document.uploadedById === requestingUserId) {
      isAuthorized = true;
    }
        
    // Rule 2: The owner of the linked property can access it.
    if (!isAuthorized && document.propertyId) {
      if (document.property.ownerId === requestingUserId) {
        isAuthorized = true;
      }
    }
        
    // Rule 3: A landlord can access a tenant's document if there's a rental application.
    if (!isAuthorized && !document.propertyId) {
      const rentalApplication = await prisma.rental.findFirst({
        where: {
          renterId: document.uploadedById,
          property: {
            ownerId: requestingUserId,
          },
        },
      });

      if (rentalApplication) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      throw { status: 403, message: 'You are not authorized to access this document.' };
    }

    const blockBlobClient = containerClient.getBlockBlobClient(document.uniqueFileName);
    const sasToken = await generateBlobSASQueryParameters({
      containerName,
      blobName: document.uniqueFileName,
      permissions: BlobSASPermissions.parse("r"), // Read
      expiresOn: new Date(new Date().valueOf() + SAS_EXPIRATION_MINUTES * 60 * 1000), // 10 minutos
    }, sharedKeyCredential).toString();

    AzureLogger.info("[getDocumentDownloadUrl] Success", { requestingUserId, documentId });
    return `${blockBlobClient.url}?${sasToken}`;
  } catch (err) {
    AzureLogger.error(err, { requestingUserId, documentId, operation: "getDocumentDownloadUrl" });
    throw err;
  }
};

/**
 * Deletes a document from both Azure Blob Storage and the database.
 * The operation is authorized to ensure only the user who uploaded the document can delete it.
 * @param {number} documentId - The unique identifier of the document to be deleted.
 * @param {number} requestingUserId - The ID of the user attempting to perform the deletion.
 * @returns {Promise<{success: boolean, message: string}>} A confirmation object upon successful deletion.
 */
const deleteDocument = async (documentId, requestingUserId) => {
  AzureLogger.info("[deleteDocument] Start", { requestingUserId, documentId });
  // Find document and verify ownership in a single step.
  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new Error('Document not found');
    }
    
    // Check if user owns the document
    if (document.uploadedById !== requestingUserId) {
      throw { status: 403, message: 'You are not authorized to delete this document.' };
    }

    // Delete from blob storage
    try {
      const blockBlobClient = containerClient.getBlockBlobClient(document.uniqueFileName);
      // `deleteIfExists` is idempotent: it won't throw an error if the blob is already gone.
      await blockBlobClient.deleteIfExists();
    } catch (error) {
      AzureLogger.error(error, { requestingUserId, documentId, operation: "deleteDocument" });
      throw { status: 500, message: 'Failed to delete file from storage.'};
    }
    
    // If blob deletion is successful, delete the record from the database.
    await prisma.document.delete({
      where: { id: documentId },
    });

    AzureLogger.info("[deleteDocument] Success", { requestingUserId, documentId });
    return { success: true, message: 'Document deleted successfully' };
  } catch (err) {
    AzureLogger.error(err, { requestingUserId, documentId, operation: "deleteDocument" });
    throw err;
  }
};

const superUpload = async ({ originalName, mimeType, size, type, propertyId = null, userId, buffer }) => {
  AzureLogger.info("[superUpload] Start", { userId, type, propertyId });
  try {
    validateDocumentRequest(type, size, mimeType);
    
    // Authorize: check if the user is the owner of the property for property-related documents.
    if (propertyId) {
        const property = await prisma.property.findUnique({ where: { id: parseInt(propertyId) } });
        if (!property) throw { status: 404, message: 'Property not found.' };
        if (property.ownerId !== userId) throw { status: 403, message: 'You are not the owner of this property.' };
    }

    // Create a unique filename and virtual folder path for security and organization.
    const extension = path.extname(originalName);
    const uniqueFileName = `${type.toLowerCase()}/${uuidv4()}${extension}`; 

    const blockBlobClient = containerClient.getBlockBlobClient(uniqueFileName);
    try {
      await blockBlobClient.uploadData(buffer, {
        blobHTTPHeaders: { blobContentType: mimeType },
      });
    } catch (err) {
      AzureLogger.error(err, { userId, type, propertyId, operation: "superUpload" });
      throw { status: 500, message: "Error subiendo archivo a Blob Storage", detail: err.message };
    }

    const document = await prisma.document.create({
      data: {
        uniqueFileName,
        originalName,
        mimeType,
        size,
        type,
        storageUrl: blockBlobClient.url,
        status: DocumentStatus.PENDING_VALIDATION,
        uploadedById: userId,
        propertyId: propertyId ? parseInt(propertyId) : undefined,
      },
    });

    AzureLogger.info("[superUpload] Success", { userId, documentId: document.id });
    return document;
  } catch (err) {
    AzureLogger.error(err, { userId, type, propertyId, operation: "superUpload" });
    throw err;
  }
}

export const documentsService = {
  prepareUpload,
  confirmUpload,
  reviewDocument,
  getMyDocuments,
  getDocumentDownloadUrl,
  deleteDocument,
  superUpload
};