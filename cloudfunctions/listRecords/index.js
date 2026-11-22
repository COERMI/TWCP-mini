// cloudfunctions/listRecords/index.js —— 后台档案列表
// 职责：管理员 token 校验 -> 组合筛选 -> 分页查询 transport_records
const cloud = require('wx-server-sdk');
const { verifyToken } = require('./auth');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 转义正则特殊字符，避免用户输入破坏查询
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

exports.main = async (event) => {
  const token = (event.token || '').trim();
  if (!verifyToken(token)) {
    return { success: false, code: 'FORBIDDEN', message: '登录已失效，请重新登录' };
  }

  const page = Math.max(1, parseInt(event.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(event.pageSize, 10) || 10));
  const keyword = (event.keyword || '').trim();
  const status = (event.status || '').trim();
  const dateFrom = (event.date_from || '').trim();
  const dateTo = (event.date_to || '').trim();

  const conditions = [];
  if (keyword) {
    conditions.push(
      _.or([
        { record_no: db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' }) },
        { plate_number: db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' }) },
      ])
    );
  }
  if (status) {
    conditions.push({ status });
  }
  if (dateFrom) {
    conditions.push({ created_at: _.gte(new Date(dateFrom + 'T00:00:00+08:00')) });
  }
  if (dateTo) {
    conditions.push({ created_at: _.lte(new Date(dateTo + 'T23:59:59+08:00')) });
  }

  let query = db.collection('transport_records');
  if (conditions.length === 1) {
    query = query.where(conditions[0]);
  } else if (conditions.length > 1) {
    query = query.where(_.and(conditions));
  }

  try {
    const countRes = await query.count();
    const total = countRes.total || 0;

    const listRes = await query
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();

    const list = listRes.data.map((r) => ({
      id: r._id,
      record_no: r.record_no,
      plate_number: r.plate_number,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      submitted_at: r.submitted_at || null,
      photo_count: r.photo_count || 0,
      event_count: r.event_count || 0,
    }));

    return { success: true, data: { list, total, page, pageSize } };
  } catch (e) {
    return { success: false, code: 'DB_ERROR', message: '查询失败，请重试' };
  }
};
