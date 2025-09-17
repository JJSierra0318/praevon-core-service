import { PrismaClient } from "../generated/prisma/index.js";
import { AzureLogger } from "../services/azureLogger.js";

const prisma = new PrismaClient();

const getMe = async (req, res, next) => {
  AzureLogger.info("[getMe] Start", { userId: req.userId });
  try {
    const user = await prisma.user.findUnique({ 
      where: { id:req.userId},
      select: { password: false, rentals: true, properties: true, username: true, email: true, phone: true, createdAt: true, identified: true }
      });
    AzureLogger.info("[getMe] Success", { userId: req.userId });
    res.json(user)
  } catch (err) {
    AzureLogger.error(err, { userId: req.userId, operation: "getMe" });
    next(err)
  }
};

const getUserById = async (req, res, next) => {
  AzureLogger.info("[getUserById] Start", { userId: req.userId, targetUserId: req.params.id });
  try {
    const id = parseInt(req.params.id);
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, createdAt: true, properties: true }
    });
    if (!user) {
      AzureLogger.warn("[getUserById] User not found", { userId: req.userId, targetUserId: req.params.id });
      return res.status(404).json({ error: 'User not found' });
    }
    AzureLogger.info("[getUserById] Success", { userId: req.userId, targetUserId: req.params.id });
    res.json(user);
  } catch (err) { 
    AzureLogger.error(err, { userId: req.userId, targetUserId: req.params.id, operation: "getUserById" });
    next(err); 
  }
};

export {getMe, getUserById};

