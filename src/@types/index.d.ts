import { RedisClientType } from "redis";

declare global {
   namespace Express {
      interface Request {
         redis: RedisClientType;

         user: string;
      }
   }
}
