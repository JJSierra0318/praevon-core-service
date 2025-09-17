import { PrismaClient } from "../generated/prisma/index.js";
import { AzureLogger } from "../services/azureLogger.js";

const prisma = new PrismaClient();

const listProperties = async (req, res, next) => {
  AzureLogger.info("[listProperties] Start", { userId: req.userId });
  try {
    const { page = 1, limit = 10, city, status, minPrice, maxPrice, q } = req.query;
    const where = {};
    if (city) where.city = { equals: city, mode: 'insensitive' };
    if (status) where.status = status;
    if (minPrice || maxPrice) where.price = {};
    if (minPrice) where.price.gte = Number(minPrice);
    if (maxPrice) where.price.lte = Number(maxPrice);
    if (q) where.OR = [
      { title: { contains: q, mode: 'insensitive' }},
      { description: { contains: q, mode: 'insensitive' }}
    ];

    const take = Math.min(100, Number(limit));
    const skip = (Number(page) - 1) * take;

    const [total, items] = await Promise.all([
      prisma.property.count({ where }),
      prisma.property.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          owner: { select: { id: true, username: true }},
          documents: {
            select: {
              id: true,
              storageUrl: true,
              type: true,
              originalName: true
            }
          }
        }
      })
    ]);

    AzureLogger.info("[listProperties] Success", { userId: req.userId, total });
    res.json({ page: Number(page), limit: take, total, items });
  } catch (err) { 
    AzureLogger.error(err, { userId: req.userId, operation: "listProperties" });
    next(err); 
  }
};


const getProperty = async (req, res, next) => {
  AzureLogger.info("[getProperty] Start", { userId: req.userId, propertyId: req.params.id });
  try {
    const id = parseInt(req.params.id);
    const prop = await prisma.property.findUnique({
      where: { id },
      include: { 
        owner: { select: { id: true, username: true }},
        rentals: true,
        documents: {
          select: {
            id: true,
            storageUrl: true,
            type: true,
            originalName: true
          }
        }
      }
    });

    if (!prop) {
      AzureLogger.warn("[getProperty] Property not found", { userId: req.userId, propertyId: req.params.id });
      return res.status(404).json({ error: 'Property not found' });
    }
    AzureLogger.info("[getProperty] Success", { userId: req.userId, propertyId: req.params.id });
    res.json(prop);
  } catch (err) { 
    AzureLogger.error(err, { userId: req.userId, propertyId: req.params.id, operation: "getProperty" });
    next(err); 
  }
};


const createProperty = async (req, res, next) => {
  AzureLogger.info("[createProperty] Start", { userId: req.userId });
  try {
    const { title, description, address, city, price } = req.body;
    const property = await prisma.property.create({
      data: {
        title, description, address, city,
        price: Number(price),
        owner: { connect: { id: req.userId }}
      }
    });
    AzureLogger.info("[createProperty] Success", { userId: req.userId, propertyId: property.id });
    res.status(201).json(property);
  } catch (err) { 
    AzureLogger.error(err, { userId: req.userId, operation: "createProperty" });
    next(err); 
  }
};

const updateProperty = async (req, res, next) => {
  AzureLogger.info("[updateProperty] Start", { userId: req.userId, propertyId: req.params.id });
  try {
    const id = parseInt(req.params.id);
    const prop = await prisma.property.findUnique({ where: { id }});
    if (!prop) {
      AzureLogger.warn("[updateProperty] Property not found", { userId: req.userId, propertyId: req.params.id });
      return res.status(404).json({ error: 'Property not found' });
    }
    if (prop.ownerId !== req.userId) {
      AzureLogger.warn("[updateProperty] Unauthorized", { userId: req.userId, propertyId: req.params.id });
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { title, description, address, city, price, status } = req.body;
    const updated = await prisma.property.update({
      where: { id },
      data: { title, description, address, city, price: price === undefined ? undefined : Number(price), status }
    });
    AzureLogger.info("[updateProperty] Success", { userId: req.userId, propertyId: req.params.id });
    res.json(updated);
  } catch (err) { 
    AzureLogger.error(err, { userId: req.userId, propertyId: req.params.id, operation: "updateProperty" });
    next(err); 
  }
};

const deleteProperty = async (req, res, next) => {
  AzureLogger.info("[deleteProperty] Start", { userId: req.userId, propertyId: req.params.id });
  try {
    const id = parseInt(req.params.id);

    const prop = await prisma.property.findUnique({
      where: { id },
      include: {
        rentals: true,
        contracts: true,
      },
    });

    if (!prop) {
      AzureLogger.warn("[deleteProperty] Property not found", { userId: req.userId, propertyId: req.params.id });
      return res.status(404).json({ error: 'Property not found' });
    }

    if (prop.ownerId !== req.userId) {
      AzureLogger.warn("[deleteProperty] Unauthorized", { userId: req.userId, propertyId: req.params.id });
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await prisma.$transaction(async (tx) => {
      for (const contract of prop.contracts) {
        await tx.contract.delete({
          where: { id: contract.id },
        });
      }

      for (const rental of prop.rentals) {
        await tx.rental.delete({
          where: { id: rental.id },
        });
      }

      await tx.property.delete({
        where: { id },
      });
    });

    AzureLogger.info("[deleteProperty] Success", { userId: req.userId, propertyId: req.params.id });
    res.status(204).send();
  } catch (err) {
    AzureLogger.error(err, { userId: req.userId, propertyId: req.params.id, operation: "deleteProperty" });
    next(err);
  }
};

export {listProperties, getProperty, createProperty, updateProperty, deleteProperty}