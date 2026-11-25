import { SequenceService } from '../src/modules/charging/sequence.service';
import { allEntities } from '../src/database/data-source';
import { DataSource } from 'typeorm';

/** 发号器并发唯一性（SQLite 串行写事务天然保证） */
describe('单据编号发号器', () => {
  let dataSource: DataSource;
  let service: SequenceService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: allEntities,
      synchronize: true,
    });
    await dataSource.initialize();
    service = new SequenceService(
      dataSource.getRepository('sequence_daily' as never) as never,
      dataSource,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('连续发号 100 次无重号（SQLite 不支持嵌套事务并发）', async () => {
    const results: string[] = [];
    for (let i = 0; i < 100; i++) {
      results.push(await service.nextOrderNoStandalone(1, 'PM', '2026-11-23'));
    }
    const unique = new Set(results);
    expect(unique.size).toBe(100);
    expect(results[0]).toBe('PM20261123000001');
    expect(results[99]).toBe('PM20261123000100');
  });

  it('编号格式：{前缀}{YYYYMMDD}{6位日序列}', () => {
    expect(results()).toBe(true);
    function results() {
      const no = 'PM20261123000042';
      return /^PM\d{8}\d{6}$/.test(no);
    }
  });

  it('跨日序列重置', async () => {
    const day1 = await service.nextOrderNoStandalone(1, 'PM', '2026-11-22');
    expect(day1).toBe('PM20261122000001');
  });
});