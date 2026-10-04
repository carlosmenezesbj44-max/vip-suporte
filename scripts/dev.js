const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';
const children = [];
let shuttingDown = false;

function run(label, args, options = {}) {
  const child = spawn(npm, args, {
    stdio: 'inherit',
    shell: isWindows,
    ...options,
  });
  children.push({ label, child });
  child.on('exit', (code) => {
    if (!shuttingDown && code && code !== 0) {
      console.error(`${label} encerrou com código ${code}.`);
      shutdown(code);
    }
  });
  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  setTimeout(() => {
    for (const { child } of children) {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    process.exit(exitCode);
  }, 2000).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  const composeAvailable = await commandWorks('docker', ['compose', 'version']);

  if (composeAvailable) {
    const db = spawn('docker', ['compose', 'up', '-d', 'postgres'], { stdio: 'inherit' });
    const code = await new Promise((resolve) => db.on('exit', resolve));
    if (code !== 0) throw new Error('Não foi possível iniciar o PostgreSQL pelo Docker Compose.');
  } else {
    const dockerAvailable = await commandWorks('docker', ['info']);
    const existingDb = dockerAvailable && await commandWorks('docker', ['container', 'inspect', 'canal-direto-postgres']);
    if (existingDb) {
      console.log('Docker Compose não encontrado; iniciando o container canal-direto-postgres existente.');
      const start = spawn('docker', ['start', 'canal-direto-postgres'], { stdio: 'inherit' });
      const code = await new Promise((resolve) => start.on('exit', resolve));
      if (code !== 0) throw new Error('Não foi possível iniciar o container PostgreSQL existente.');
    } else {
      console.log('Docker Compose não encontrado; tentando usar PostgreSQL já iniciado localmente.');
    }
  }

  await waitForDatabase();

  console.log('Preparando pacote compartilhado e banco...');
  const setup = spawn(npm, ['run', 'dev:setup'], { stdio: 'inherit', shell: isWindows });
  const setupCode = await new Promise((resolve) => setup.on('exit', resolve));
  if (setupCode !== 0) throw new Error(`Preparação do projeto falhou (código ${setupCode}). Confira a conexão do banco em apps/api/.env e veja o erro acima.`);

  console.log('Iniciando API (http://localhost:3333) e painel web (http://localhost:3000)...');
  run('API', ['run', 'dev:api']);
  run('Web', ['run', 'dev:web']);
}

function commandWorks(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
}

function databaseAddress() {
  const envPath = path.join(__dirname, '..', 'apps', 'api', '.env');
  const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const match = envText.match(/^\s*DATABASE_URL\s*=\s*['"]?([^'"\r\n]+)['"]?\s*$/m);
  const connectionString = process.env.DATABASE_URL || (match && match[1]);
  if (!connectionString) throw new Error('DATABASE_URL não foi encontrada em apps/api/.env.');
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL inválida em apps/api/.env.');
  }
  return { host: url.hostname, port: Number(url.port || 5432) };
}

async function waitForDatabase() {
  const { host, port } = databaseAddress();
  const timeoutMs = 30000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (connected) return;
    await delay(500);
  }
  throw new Error(`PostgreSQL não respondeu em ${host}:${port} após ${timeoutMs / 1000}s. Inicie o banco ou confira DATABASE_URL em apps/api/.env.`);
}

main().catch((error) => {
  console.error(error.message);
  shutdown(1);
});
