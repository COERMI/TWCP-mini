'use strict';
function createStore(db) {
  const read = async (source, collection, id) => {
    const result = await source.collection(collection).doc(id).get();
    return result.data || null;
  };
  return {
    get: (collection, id) => read(db, collection, id),
    list: async (collection, filter, cursor, limit) => {
      const query = cursor ? { ...filter, _id: db.command.gt(cursor) } : filter;
      const result = await db.collection(collection).where(query).orderBy('_id', 'asc').limit(limit).get();
      return result.data;
    },
    searchRecords: async (collection, options) => {
      const { source, keyword, phase, from, to, page, pageSize } = options, command = db.command, filters = [];
      if (keyword) {
        const regex = db.RegExp({ regexp: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' });
        filters.push(command.or([{ record_no: regex }, { plate_number: regex }]));
      }
      if (phase) filters.push(source === 'v1' ? { phase } : { status: phase === 'legacy_submitted' ? 'submitted' : 'active' });
      const date = value => source === 'legacy' ? new Date(value) : value;
      if (from !== null) filters.push({ created_at: command.gte(date(from)) });
      if (to !== null) filters.push({ created_at: command.lt(date(to)) });
      let query = db.collection(collection);
      if (filters.length) query = query.where(filters.length === 1 ? filters[0] : command.and(filters));
      const [counted, records] = await Promise.all([
        query.count(), query.orderBy('created_at', 'desc').orderBy('_id', 'desc').skip((page - 1) * pageSize).limit(pageSize).get(),
      ]);
      return { total: counted.total, list: records.data };
    },
    transaction: callback => db.runTransaction(async transaction => callback({
      get: (collection, id) => read(transaction, collection, id),
      set: async (collection, id, data) => {
        const { _id, ...body } = data;
        if (_id !== id) throw new Error('Document identity mismatch');
        await transaction.collection(collection).doc(id).set({ data: body });
      },
    })),
  };
}
module.exports = { createStore };
