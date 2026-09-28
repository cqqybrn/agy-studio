import { buildApp } from './app.js';

const app = buildApp();
const port = Number(process.env.PORT) || 8790;
const host = process.env.HOST || '127.0.0.1';

app.listen({ port, host }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening on ${address}`);
});
