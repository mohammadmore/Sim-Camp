/**
 * SQL store template (DB_ADAPTER=sql).
 *
 * To run the Node server on your own SQL database, implement the store API described in
 * db/index.js (db/memoryStore.js is a complete reference implementation). A suggested schema:
 *
 *   camps    (id PK, doc JSON, rev INT)                  -- teams are stored without scoreLogs
 *   logs     (camp_id, id, data JSON, PRIMARY KEY (camp_id, id))
 *   settings (key PK, value JSON)
 *   media    (name PK, content_type, data BLOB)
 *
 * commit() must update the camp row only when rev = expectedRev (UPDATE ... WHERE rev = ?) and
 * throw ConflictError otherwise. watchCamp() may poll the rev every second when the database has
 * no change notifications; with a single server instance it can simply return () => {}.
 */
import { ConflictError, ExistsError, NotFoundError } from './errors.js';

const todo = name => async () => { throw new Error(`${name} is not implemented in db/sqlStore.js yet.`); };

export function createSqlStore() {
    void ConflictError; void ExistsError; void NotFoundError;
    return {
        info() { return { mode: 'sql', media: 'sql' }; },
        getCampDoc: todo('getCampDoc'),
        getCampLogs: todo('getCampLogs'),
        createCamp: todo('createCamp'),
        commit: todo('commit'),
        deleteCamp: todo('deleteCamp'),
        listCamps: todo('listCamps'),
        watchCamp() { return () => {}; },
        getSetting: todo('getSetting'),
        setSetting: todo('setSetting'),
        createSettingIfAbsent: todo('createSettingIfAbsent'),
        putMedia: todo('putMedia'),
        getMedia: todo('getMedia')
    };
}
