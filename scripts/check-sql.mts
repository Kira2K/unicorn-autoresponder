import { checkSqlStorage } from '../src/features/web-console/backend/postgres/check.mts';
import { PostgresReadError } from '../src/integrations/postgres/contracts.mts';

try {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || (major === 24 && minor < 12)) throw new Error('node_version');
  if (process.argv.length > 3) throw new Error('arguments');
  process.loadEnvFile(process.argv[2] ?? '.env');
  const result = await checkSqlStorage(process.env);
  console.log(`SQL доступна. Проверено таблиц: ${result.tables}; таблиц с выдачей ID: ${result.idTables}.`);
  console.log('Записей и отправок не было. Приложение и старые задания не запускались.');
  console.log('Перед обычным запуском отдельно проверьте незавершённые задания, расписания и другие работающие экземпляры.');
} catch (error) {
  const code = error instanceof PostgresReadError ? error.code :
    error instanceof Error && ['node_version', 'arguments'].includes(error.message) ? error.message : 'sql_check_failed';
  console.error(`Проверка остановлена: ${code}. Проверьте Node 24.12.0 или новее, ENV, доступ к SQL и структуру базы.`);
  process.exitCode = 1;
}
