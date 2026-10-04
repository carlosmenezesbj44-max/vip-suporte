/**
 * Script utilitário para criar/atualizar um usuário ADMIN diretamente no banco,
 * sem depender da API estar rodando.
 *
 * Uso:
 *   node scripts/create-admin.js <email> <senha> ["Nome completo"]
 *
 * Exemplo:
 *   node scripts/create-admin.js admin@exemplo.com minhasenha123 "Admin"
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

async function main() {
  const [, , email, password, name] = process.argv;

  if (!email || !password) {
    console.error('Uso: node scripts/create-admin.js <email> <senha> ["Nome"]');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash, role: 'ADMIN' },
      create: {
        name: name || 'Administrador',
        email,
        passwordHash,
        role: 'ADMIN',
      },
    });

    console.log(`Usuário ADMIN pronto: ${user.email} (id: ${user.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Falha ao criar usuário admin:', err);
  process.exit(1);
});
