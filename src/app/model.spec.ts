import * as gen from '../../server/generator.mjs';
import { ALERT, ALERT_CODES, KINDS, METRIC, REGIONS, RESOLVE, STATUS, STATUS_CHANGE } from './model';

describe('wire format', () => {
  it('matches the generator', () => {
    expect([...STATUS]).toEqual([...gen.STATUS]);
    expect([...REGIONS]).toEqual([...gen.REGIONS]);
    expect([...KINDS]).toEqual([...gen.KINDS]);
    expect([...ALERT_CODES]).toEqual([...gen.ALERT_CODES]);
    expect([METRIC, STATUS_CHANGE, ALERT, RESOLVE]).toEqual([gen.METRIC, gen.STATUS_CHANGE, gen.ALERT, gen.RESOLVE]);
  });
});
