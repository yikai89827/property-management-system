export default () => ({
  port: Number(process.env.PORT ?? 3000),
  databasePath: process.env.DATABASE_PATH ?? './data/pms.db',
  encryptionKey: process.env.ENCRYPTION_KEY ?? '',
  blindIndexKey: process.env.BLIND_INDEX_KEY ?? '',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
    ownerTtl: Number(process.env.JWT_OWNER_TTL ?? 7200),
  },
  defaultCompanyName: process.env.DEFAULT_COMPANY_NAME ?? '株洲卓信物业管理有限责任公司',
  receiptNoPrefix: process.env.RECEIPT_NO_PREFIX ?? 'PM',
  h5BaseUrl: process.env.H5_BASE_URL ?? 'http://localhost:5171',
});