import { Router } from "express";
import { body, param } from "express-validator";
import handleValidation from "../middlewares/validators.js";
import auth from "../middlewares/auth.js";
import {
  getContract,
  listMyContracts,
  generateContractPdf,
  getContractPdfDownloadUrl,
  signContract,
  notarizeContract,
  getContractByRental
} from "../controllers/contractsController.js";
import { ContractStatus } from "../generated/prisma/index.js";

const contractsRouter = Router();
contractsRouter.use(auth);

contractsRouter.get("/", listMyContracts);
contractsRouter.get("/:id", getContract);
contractsRouter.get("/:id/reid", getContractByRental);
contractsRouter.post("/:id/generate-pdf", generateContractPdf);
contractsRouter.get('/:id/download-url', param('id').isInt(), handleValidation, getContractPdfDownloadUrl);
contractsRouter.post('/:id/sign', param('id').isInt(), handleValidation, signContract);
contractsRouter.post('/:id/notary', param('id').isInt(), handleValidation, notarizeContract);
export default contractsRouter;
