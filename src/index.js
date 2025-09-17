import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { AzureLogger } from "./services/azureLogger.js";
import authRouter from "./routes/auth.js";
import userRouter from "./routes/user.js";
import propertiesRouter from "./routes/properties.js";
import rentalsRouter from "./routes/rentals.js";
import documentsRouter from "./routes/documents.js";
import contractsRouter from "./routes/contracts.js";
import errorHandler from "./middlewares/errorHandler.js";

dotenv.config();
const app = express();
// eslint-disable-next-line no-undef
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(cors());
app.use(express.json());
// Replace default morgan with AzureLogger integration
app.use(morgan('combined', {
    stream: {
        write: (message) => AzureLogger.info(message.trim())
    }
}));

// Custom trace for each request
app.use((req, res, next) => {
    AzureLogger.info(`Incoming request: ${req.method} ${req.originalUrl}`, {
        method: req.method,
        url: req.originalUrl,
        user: req.user ? req.user.id : undefined,
    });
    next();
});

const coreServiceRouter = express.Router();

coreServiceRouter.use('/auth', authRouter);
coreServiceRouter.use('/users', userRouter);
coreServiceRouter.use('/properties', propertiesRouter);
coreServiceRouter.use('/rentals', rentalsRouter);
coreServiceRouter.use('/documents', documentsRouter);
coreServiceRouter.use('/contracts', contractsRouter);

app.use('/api/core-service/v1', coreServiceRouter);

app.get('/health', (req, res) => res.json({
    ok:true
}));


// Error logging middleware (before errorHandler)
app.use((err, req, res, next) => {
    AzureLogger.error(err, {
        method: req.method,
        url: req.originalUrl,
        user: req.user ? req.user.id : undefined,
    });
    next(err);
});

app.use(errorHandler);

app.listen(PORT, ()=>{
    console.log(`Core service running on http://localhost:${PORT}`);
});