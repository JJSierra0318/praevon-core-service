import { PrismaClient, PropertyStatus, RentalStatus } from "../generated/prisma/index.js";
import { AzureLogger } from "../services/azureLogger.js";
import { contractsService } from "../services/contractsService.js";
const prisma = new PrismaClient();

const createRental = async (req, res, next) => {
  AzureLogger.info("[createRental] Start", { userId: req.userId, propertyId: req.body.propertyId });
  try {
    const { propertyId } = req.body;
    const pid = parseInt(propertyId);

    const property = await prisma.property.findUnique({ where: { id: pid }});
    if (!property) {
      AzureLogger.warn("[createRental] Property not found", { userId: req.userId, propertyId });
      return res.status(404).json({ error: 'The property you are trying to rent does not exist.' });
    }
    if (property.ownerId === req.userId) {
      AzureLogger.warn("[createRental] Cannot rent own property", { userId: req.userId, propertyId });
      return res.status(400).json({ error: 'You cannot rent your own property.' });
    }

    const existing = await prisma.rental.findFirst({
      where: { propertyId: pid, renterId: req.userId, status: RentalStatus.PENDING }
    });
    if (existing) {
      AzureLogger.warn("[createRental] Pending rental exists", { userId: req.userId, propertyId });
      return res.status(400).json({ error: 'You already have a pending rental request for this property.' });
    }

    const rental = await prisma.rental.create({
      data: {
        property: { connect: { id: pid }},
        renter: { connect: { id: req.userId }},
        status: RentalStatus.PENDING
      }
    });
    AzureLogger.info("[createRental] Success", { userId: req.userId, propertyId, rentalId: rental.id });
    res.status(201).json(rental);
  } catch (err) { 
    AzureLogger.error(err, { userId: req.userId, propertyId: req.body.propertyId, operation: "createRental" });
    next(err); 
  }
};

const listRentalsForUser = async (req, res, next) => {
  AzureLogger.info("[listRentalsForUser] Start", { userId: req.userId });
  try {
    const rentals = await prisma.rental.findMany({
      where: { renterId: req.userId },
      include: { property: true }
    });
    AzureLogger.info("[listRentalsForUser] Success", { userId: req.userId, count: rentals.length });
    res.json(rentals);
  } catch (err) { 
    AzureLogger.error(err, { userId: req.userId, operation: "listRentalsForUser" });
    next(err); 
  }
};

const listRentalsForOwner = async (req, res, next) => {
  AzureLogger.info("[listRentalsForOwner] Start", { userId: req.userId });
  try {
    const rentals = await prisma.rental.findMany({
      where: {
        property: {
          ownerId: req.userId
        }
      },
      include: {
        property: true,
        renter: {
          select: { id: true, username: true, email: true }
        }
      }
    });
    AzureLogger.info("[listRentalsForOwner] Success", { userId: req.userId, count: rentals.length });
    res.json(rentals);
  } catch (err) {
    AzureLogger.error(err, { userId: req.userId, operation: "listRentalsForOwner" });
    next(err);
  }
};

const updateRentalStatus = async (req, res, next) => {
  AzureLogger.info("[updateRentalStatus] Start", { userId: req.userId, rentalId: req.params.id });
  try {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    const rental = await prisma.rental.findUnique({ where: { id }, include: { property: true }});
    if (!rental) {
      AzureLogger.warn("[updateRentalStatus] Rental not found", { userId: req.userId, rentalId: req.params.id });
      return res.status(404).json({ error: 'Rental not found' });
    }

    if (rental.property.ownerId !== req.userId) {
      AzureLogger.warn("[updateRentalStatus] Unauthorized", { userId: req.userId, rentalId: req.params.id });
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const updated = await prisma.rental.update({
      where: { id },
      data: { status }
    });

    if (status === RentalStatus.ACCEPTED) {
      await prisma.property.update({ 
        where: { id: rental.propertyId }, 
        data: { status: PropertyStatus.IN_PROCESS }
      });

      // Create a Draft Contract  when a rental is accepted
      await contractsService.createContractFromRental(rental);

    } else if (
      (status === RentalStatus.REJECTED || status === RentalStatus.CANCELLED) &&
      rental.status === RentalStatus.ACCEPTED) {
      await prisma.property.update({
        where: { id: rental.propertyId },
        data: { status: PropertyStatus.AVAILABLE }
      });
      
    }
    AzureLogger.info("[updateRentalStatus] Success", { userId: req.userId, rentalId: req.params.id });
    res.json(updated);
  } catch (err) { 
    AzureLogger.error(err, { userId: req.userId, rentalId: req.params.id, operation: "updateRentalStatus" });
    next(err); 
  }
};

export {createRental, listRentalsForUser, listRentalsForOwner, updateRentalStatus};