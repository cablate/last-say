const ACTIVE_RECORD_STATUS_SQL = "COALESCE(record_status,'posted') NOT IN ('reversed','superseded','archived')";

function activeRecordSql(alias = '') {
  return `COALESCE(${alias ? `${alias}.` : ''}record_status,'posted') NOT IN ('reversed','superseded','archived')`;
}

module.exports = { ACTIVE_RECORD_STATUS_SQL, activeRecordSql };
