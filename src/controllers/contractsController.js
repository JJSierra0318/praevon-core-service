import { contractsService } from "../services/contractsService.js";
import { AzureLogger } from "../services/azureLogger.js";

const getContract = async (req, res, next) => {
  AzureLogger.info("[getContract] Start", { userId: req.userId, contractId: req.params.id });
  try {
    const contract = await contractsService.getContractById(
      parseInt(req.params.id),
      req.userId
    );
    AzureLogger.info("[getContract] Success", { userId: req.userId, contractId: req.params.id });
    res.json(contract);
  } catch (err) {
    AzureLogger.error(err, { userId: req.userId, contractId: req.params.id, operation: "getContract" });
    next(err);
  }
};

const listMyContracts = async (req, res, next) => {
  AzureLogger.info("[listMyContracts] Start", { userId: req.userId });
  try {
    const contracts = await contractsService.listUserContracts(req.userId);
    AzureLogger.info("[listMyContracts] Success", { userId: req.userId });
    res.json(contracts);
  } catch (err) {
    AzureLogger.error(err, { userId: req.userId, operation: "listMyContracts" });
    next(err);
  }
};

const generateContractPdf = async (req, res, next) => {
  AzureLogger.info("[generateContractPdf] Start", { userId: req.userId, contractId: req.params.id });
  try {
    const updatedContract = await contractsService.generateAndUploadPdf(
      parseInt(req.params.id),
      req.userId
    );
    AzureLogger.info("[generateContractPdf] Success", { userId: req.userId, contractId: req.params.id });
    res.json({
      message: "PDF generated and uploaded successfully",
      contract: updatedContract,
    });
  } catch (err) {
    AzureLogger.error(err, { userId: req.userId, contractId: req.params.id, operation: "generateContractPdf" });
    next(err);
  }
};

const getContractPdfDownloadUrl = async (req, res, next) => {
  AzureLogger.info("[getContractPdfDownloadUrl] Start", { userId: req.userId, contractId: req.params.id });
  try {
    const downloadUrl = await contractsService.getContractPdfDownloadUrl(parseInt(req.params.id), req.userId);
    AzureLogger.info("[getContractPdfDownloadUrl] Success", { userId: req.userId, contractId: req.params.id });
    res.json({ downloadUrl });
  } catch (err) {
    AzureLogger.error(err, { userId: req.userId, contractId: req.params.id, operation: "getContractPdfDownloadUrl" });
    next(err);
  }
};

const signContract = async (req, res, next) => {
  AzureLogger.info("[signContract] Start", { userId: req.userId, contractId: req.params.id });
  try {
    const isSigned = await contractsService.signContractStatus(parseInt(req.params.id), req.userId);
    AzureLogger.info("[signContract] Success", { userId: req.userId, contractId: req.params.id });
    res.json({ isSigned });
  } catch (err) {
    AzureLogger.error(err, { userId: req.userId, contractId: req.params.id, operation: "signContract" });
    next(err);
  }
};

const notarizeContract = async (req, res, next) => {
  AzureLogger.info("[notarizeContract] Start", { userId: req.userId, contractId: req.params.id });
  try {
    const isNotarized = await contractsService.notarizeContractStatus(parseInt(req.params.id), req.userId);
    AzureLogger.info("[notarizeContract] Success", { userId: req.userId, contractId: req.params.id });
    res.json({ isNotarized });
  } catch (err) {
    AzureLogger.error(err, { userId: req.userId, contractId: req.params.id, operation: "notarizeContract" });
    next(err);
  }
};

export { getContract, listMyContracts, generateContractPdf, getContractPdfDownloadUrl, signContract, notarizeContract };
