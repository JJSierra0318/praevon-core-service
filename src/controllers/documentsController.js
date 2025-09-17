import { documentsService } from '../services/documentsService.js';
import { AzureLogger } from "../services/azureLogger.js";

const generateUploadUrl = async (req, res, next) => {
  AzureLogger.info("[generateUploadUrl] Start", { userId: req.userId });
  try {
    const result = await documentsService.prepareUpload({ ...req.body, userId: req.userId });
    AzureLogger.info("[generateUploadUrl] Success", { userId: req.userId });
    res.status(201).json(result);
  } catch (err) {
    AzureLogger.error(err, { userId: req.userId, operation: "generateUploadUrl" });
    next(err);
  }
};

const confirmUpload = async (req, res, next) => {
  AzureLogger.info("[confirmUpload] Start", { userId: req.userId, documentId: req.params.id });
  try {
    const updatedDocument = await documentsService.confirmUpload(parseInt(req.params.id), req.userId);
    AzureLogger.info("[confirmUpload] Success", { userId: req.userId, documentId: req.params.id });
    res.json(updatedDocument);
  } catch (err) {
    AzureLogger.error(err, { userId: req.userId, documentId: req.params.id, operation: "confirmUpload" });
    next(err);
  }
};

const unifiedUpload = async (req, res, next) => {
  AzureLogger.info("[unifiedUpload] Start", { userId: req.userId });
  try {
    const { type, propertyId } = req.body;
    const file = req.file;

    if (!file) {
      AzureLogger.warn("[unifiedUpload] No file uploaded", { userId: req.userId });
      return res.status(400).json({ message: "No file uploaded." });
    }

    const document = await documentsService.superUpload({
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      buffer: file.buffer, // el archivo en memoria
      type,
      propertyId,
      userId: req.userId,
    });

    AzureLogger.info("[unifiedUpload] Success", { userId: req.userId, documentId: document.id });
    res.status(201).json(document);
  } catch (err) {
    AzureLogger.error(err, { userId: req.userId, operation: "unifiedUpload" });
    next(err);
  }
};

const reviewDocument = async (req, res, next) => {
  AzureLogger.info("[reviewDocument] Start", { userId: req.userId, documentId: req.params.id });
  try {
    const updatedDocument = await documentsService.reviewDocument(parseInt(req.params.id), req.body.status, req.userId);
    AzureLogger.info("[reviewDocument] Success", { userId: req.userId, documentId: req.params.id });
    res.json(updatedDocument);
  } catch (err) {
    AzureLogger.error(err, { userId: req.userId, documentId: req.params.id, operation: "reviewDocument" });
    next(err);
  }
};

const getMyDocuments = async (req, res, next) => {
  AzureLogger.info("[getMyDocuments] Start", { userId: req.userId });
  try {
    const documents = await documentsService.getMyDocuments(req.userId);
    AzureLogger.info("[getMyDocuments] Success", { userId: req.userId, count: documents.length });
    res.json(documents);
  } catch (err) {
    AzureLogger.error(err, { userId: req.userId, operation: "getMyDocuments" });
    next(err);
  }
};

const getDocumentDownloadUrl = async (req, res, next) => {
  AzureLogger.info("[getDocumentDownloadUrl] Start", { userId: req.userId, documentId: req.params.id });
  try {
    const downloadUrl = await documentsService.getDocumentDownloadUrl(parseInt(req.params.id), req.userId);
    AzureLogger.info("[getDocumentDownloadUrl] Success", { userId: req.userId, documentId: req.params.id });
    res.json({ downloadUrl });
  } catch (err) {
    AzureLogger.error(err, { userId: req.userId, documentId: req.params.id, operation: "getDocumentDownloadUrl" });
    next(err);
  }
};

const deleteDocument = async (req, res, next) => {
  AzureLogger.info("[deleteDocument] Start", { userId: req.userId, documentId: req.params.id });
  try {
    await documentsService.deleteDocument(parseInt(req.params.id), req.userId);
    AzureLogger.info("[deleteDocument] Success", { userId: req.userId, documentId: req.params.id });
    res.status(204).send(); // 204 No Content response sent when deletion is successful
  } catch (err) {
    AzureLogger.error(err, { userId: req.userId, documentId: req.params.id, operation: "deleteDocument" });
    next(err);
  }
};

export { 
  generateUploadUrl, 
  confirmUpload, 
  reviewDocument,
  getMyDocuments,
  getDocumentDownloadUrl,
  deleteDocument,
  unifiedUpload
};