import { PrismaClient } from "../generated/prisma/index.js";
import { AzureLogger } from "../services/azureLogger.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();

const register = async (req, res, next) => {
    AzureLogger.info("[register] Start", { email: req.body.email });
    try {
        const { username, email, password, phone } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
            data: {
                    username,
                    email, 
                    password: hashedPassword, 
                    phone
                }
        });

        const { password: _, ...safeUser } = newUser;
        AzureLogger.info("[register] Success", { userId: newUser.id, email });
        res.status(201).json(safeUser);

    } catch (err) {
        AzureLogger.error(err, { email: req.body.email, operation: "register" });
        next(err);
    }
};

const login = async (req, res, next) => {
    AzureLogger.info("[login] Start", { email: req.body.email });
    try {
        const { email, password } = req.body;

        const user = await prisma.user.findUnique({ where: { email }});
        if(!user) {
            AzureLogger.warn("[login] Invalid credentials: user not found", { email });
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if(!passwordMatch) {
            AzureLogger.warn("[login] Invalid credentials: password mismatch", { email });
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({id: user.id}, process.env.JWT_SECRET, { expiresIn: process.env.TOKEN_EXPIRES_IN || '7d' });

        const { password: _, ...safeUser } = user;
        AzureLogger.info("[login] Success", { userId: user.id, email });
        res.json({ message: 'Succesful login', token, user: safeUser })
    } catch (err) {
        AzureLogger.error(err, { email: req.body.email, operation: "login" });
        next(err);
    }
};

export { register, login };