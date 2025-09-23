import { PrismaClient, ContractStatus, PropertyStatus, DocumentType, DocumentStatus } from "../generated/prisma/index.js";
import { AzureLogger } from "./azureLogger.js";
import { BlobServiceClient, StorageSharedKeyCredential, BlobSASPermissions, generateBlobSASQueryParameters } from "@azure/storage-blob";
import PDFDocument from "pdfkit";
import { v4 as uuidv4 } from 'uuid';
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

const createContractFromRental = async (rental) => {
    AzureLogger.info("[createContractFromRental] Start", { rentalId: rental?.id });
    // Verify that a contract does not already exist for this rental
    if (!rental || !rental.id) {
        AzureLogger.error(new Error("Valid rental object must be provided."), { rental });
        throw { status: 400, message: "Valid rental object must be provided." };
    }
    try {
        const fullRental = await prisma.rental.findUnique({
            where: { id: rental.id },
            include: { property: true },
        });
        if (!fullRental) {
            AzureLogger.error(new Error("Rental not found."), { rentalId: rental.id });
            throw { status: 404, message: "Rental not found." };
        }
        if (fullRental.status !== 'ACCEPTED') {
            AzureLogger.error(new Error('Contract can only be created from an accepted rental.'), { rentalId: rental.id });
            throw { status: 400, message: 'Contract can only be created from an accepted rental.' };
        }

        const existingContract = await prisma.contract.findUnique({
            where: { rentalId: rental.id }
        });
        if (existingContract) {
            AzureLogger.warn(`Attempted to create a duplicate contract for rental ID: ${rental.id}`);
            return existingContract;
        }

        // Use rental and property data to create the contract
        const property = await prisma.property.findUnique({ where: { id: rental.propertyId } });
        if (!property) {
            AzureLogger.error(new Error(`Property with ID ${rental.propertyId} not found for rental ID ${rental.id}`));
            throw new Error(`Property with ID ${rental.propertyId} not found for rental ID ${rental.id}`);
        }

        const contract = await prisma.contract.create({
            data: {
                rentalId: fullRental.id,
                propertyId: fullRental.propertyId,
                tenantId: fullRental.renterId,
                landlordId: fullRental.property.ownerId,
                startDate: new Date(), // Placeholder
                endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)), // Placeholder, +1 año
                monthlyRent: fullRental.property.price,
                terms: `Términos y condiciones estándar para la propiedad ubicada en ${fullRental.property.address}. El pago mensual se realizará los primeros cinco días de cada mes.`, // Placeholder
                status: ContractStatus.DRAFT,
            }
        });
        AzureLogger.info("[createContractFromRental] Success", { contractId: contract.id });
        return contract;
    } catch (err) {
        AzureLogger.error(err, { rentalId: rental?.id, operation: "createContractFromRental" });
        throw err;
    }
};

const getContractById = async (contractId, userId) => {
    AzureLogger.info("[getContractById] Start", { contractId, userId });
    try {
        const contract = await prisma.contract.findUnique({
            where: { id: contractId },
            include: {
                landlord: { select: { id: true, username: true, email: true, phone: true } },
                tenant: { select: { id: true, username: true, email: true, phone: true } },
                property: true,
            }
        });
        if (!contract) {
            AzureLogger.error(new Error('Contract not found.'), { contractId });
            throw { status: 404, message: 'Contract not found.' };
        }
        // Authorization: only the involved parties can see it
        if (contract.landlordId !== userId && contract.tenantId !== userId) {
            AzureLogger.error(new Error('Unauthorized contract access.'), { contractId, userId });
            throw { status: 403, message: 'You are not authorized to view this contract.' };
        }
        AzureLogger.info("[getContractById] Success", { contractId, userId });
        return contract;
    } catch (err) {
        AzureLogger.error(err, { contractId, userId, operation: "getContractById" });
        throw err;
    }
};

const getContractByRentalId = async (rentalId, userId) => {
    const contract = await prisma.contract.findUnique({
        where: { rentalId: rentalId },
        include: {
            landlord: { select: { id: true, username: true, email: true, phone: true } },
            tenant: { select: { id: true, username: true, email: true, phone: true } },
            property: true,
        }
    });
    if (!contract) throw { status: 404, message: 'Contract not found.' };
    
    // Authorization: only the involved parties can see it
    if (contract.landlordId !== userId && contract.tenantId !== userId) {
        throw { status: 403, message: 'You are not authorized to view this contract.' };
    }
    return contract;
};

const listUserContracts = async (userId) => {
    AzureLogger.info("[listUserContracts] Start", { userId });
    try {
        const contracts = await prisma.contract.findMany({
            where: {
                OR: [
                    { landlordId: userId },
                    { tenantId: userId }
                ]
            },
            include: { 
                property: { select: { id: true, title: true, address: true } }, 
                tenant: { select: { id: true, username: true } }, 
                landlord: { select: { id: true, username: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        AzureLogger.info("[listUserContracts] Success", { userId, count: contracts.length });
        return contracts;
    } catch (err) {
        AzureLogger.error(err, { userId, operation: "listUserContracts" });
        throw err;
    }
};


const generateAndUploadPdf = async (contractId, userId) => {
    // GET contract 
    const contract = await getContractById(contractId, userId); // Reuse existing function for auth check

    // Create the PDF in memory 
    const doc = new PDFDocument({ margin: 50, size : 'LETTER' });
    const chunks = [];
    doc.on('data', chunks.push.bind(chunks));
    
    // --- Contenido del PDF ---
    // encabezado
    doc.fontSize(22).font('Helvetica-Bold').text('CONTRATO DE ARRENDAMIENTO DE VIVIENDA URBANA', { align: 'center' });
    doc.moveDown(2);
    // Información General
    doc.fontSize(10).font('Helvetica').text(`Número de Contrato Praevon: ${contract.id}`, { align: 'right' });
    doc.text(`Fecha de Generación: ${new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })}`, { align: 'right' });
    doc.moveDown(2);

    // Función auxiliar para dibujar secciones
    const drawSection = (title, data) => {
        doc.fontSize(14).font('Helvetica-Bold').text(title, { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(11).font('Helvetica');
        Object.entries(data).forEach(([key, value]) => {
            if(value) { // Solo muestra campos que tienen valor
                doc.text(`${key}:`, { continued: true, bold: true }).text(` ${value}`);
            }
        });
        doc.moveDown();
    };

    // Partes Involucradas
    drawSection('DATOS DEL ARRENDADOR (PROPIETARIO)', {
        'Nombre Completo': contract.landlord.username,
        'Email': contract.landlord.email,
        'Teléfono': contract.landlord.phone || 'No registrado',
    });

    drawSection('DATOS DEL ARRENDATARIO (INQUILINO)', {
        'Nombre Completo': contract.tenant.username,
        'Email': contract.tenant.email,
        'Teléfono': contract.tenant.phone || 'No registrado',
    });

    // Inmueble
    drawSection('DESCRIPCIÓN DEL INMUEBLE ARRENDADO', {
        'Propiedad': contract.property.title,
        'Dirección': contract.property.address,
        'Ciudad': contract.property.city,
    });

    // Términos Financieros y de Duración
    drawSection('CONDICIONES PRINCIPALES DEL CONTRATO', {
        'Canon de Arrendamiento Mensual': `$${contract.monthlyRent.toLocaleString('es-CO')} COP`,
        'Fecha de Inicio': contract.startDate.toLocaleDateString('es-CO'),
        'Fecha de Finalización': contract.endDate.toLocaleDateString('es-CO'),
    });

    // Cláusulas / Términos
    doc.fontSize(14).font('Helvetica-Bold').text('CLÁUSULAS Y TÉRMINOS', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').text(contract.terms, { align: 'justify' });
    doc.moveDown(3);
    
    // Espacio para Firmas (placeholder)
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text('_________________________', { continued: true });
    doc.text('                                     _________________________');
    doc.text('Firma del Arrendador', { continued: true });
    doc.text('                                     Firma del Arrendatario');

    // Pie de página
    const pageHeight = doc.page.height;
    doc.fontSize(8).font('Helvetica-Oblique').text(
        `Este documento fue generado por la plataforma Praevon. ID de Contrato: ${contract.id}`, 
        50, 
        pageHeight - 50, 
        { align: 'center', width: doc.page.width - 100 }
    );

    doc.end();

    // 3. Esperar a que el stream del PDF termine y subir a Azure
    await new Promise(resolve => doc.on('end', resolve));
    const pdfBuffer = Buffer.concat(chunks);
    
    const uniqueFileName = `contracts/${uuidv4()}.pdf`;
    const blockBlobClient = containerClient.getBlockBlobClient(uniqueFileName);
    
    await blockBlobClient.upload(pdfBuffer, pdfBuffer.length, {
        blobHTTPHeaders: { blobContentType: 'application/pdf' }
    });
    
    const pdfUrl = blockBlobClient.url;

    // 4. Actualizar el contrato con la URL y cambiar estado
    return prisma.contract.update({
        where: { id: contractId },
        data: {
            contractPdfUrl: pdfUrl,
            status: ContractStatus.PENDING_SIGNATURE
        }
    });
};

const getContractPdfDownloadUrl = async (contractId, userId) => {
    const contract = await getContractById(contractId, userId);

    if (!contract.contractPdfUrl) {
        throw { status: 404, message: 'Contract PDF has not been generated for this contract yet.' };
    }

    const blobName = new URL(contract.contractPdfUrl).pathname.substring(containerName.length + 2);

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const sasToken = await generateBlobSASQueryParameters({
        containerName,
        blobName,
        permissions: BlobSASPermissions.parse("r"), // 'r' for Read
        expiresOn: new Date(new Date().valueOf() + 10 * 60 * 1000), // Válida por 5 minutos
    }, sharedKeyCredential).toString();

    return `${blockBlobClient.url}?${sasToken}`;
};

const signContractStatus = async (contractId, userId) => {
    const contract = await getContractById(contractId, userId);

    if (!contract.contractPdfUrl) {
        throw { status: 404, message: 'Contract PDF has not been generated for this contract yet.' };
    }

    return prisma.contract.update({
        where: { id: contractId },
        data: {
            status: ContractStatus.SIGNED
        }
    });
};

const notarizeContractStatus = async (contractId, userId) => {
    const contract = await getContractById(contractId, userId);

    if (!contract.contractPdfUrl) {
        throw { status: 404, message: 'Contract PDF has not been generated for this contract yet.' };
    }

    return prisma.contract.update({
        where: { id: contractId },
        data: {
            status: ContractStatus.NOTARIZED
        }
    });
};


export const contractsService = {
    createContractFromRental,
    getContractById,
    getContractByRentalId, 
    listUserContracts,
    generateAndUploadPdf,
    getContractPdfDownloadUrl,
    signContractStatus,
    notarizeContractStatus
};