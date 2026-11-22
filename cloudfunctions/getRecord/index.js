// cloudfunctions/getRecord/index.js —— 获取档案详情与事件列表（司机端）
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const recordNo = (event.record_no || '').trim();
  const accessToken = (event.access_token || '').trim();

  if (!recordNo) {
    return { success: false, code: 'INVALID', message: '缺少档案编号' };
  }

  try {
    const recRes = await db
      .collection('transport_records')
      .where({ record_no: recordNo })
      .limit(1)
      .get();

    if (recRes.data.length === 0) {
      return { success: false, code: 'NOT_FOUND', message: '档案不存在' };
    }

    const record = recRes.data[0];

    // 访问令牌校验：司机访问必须持有正确的 access_token
    if (record.access_token && accessToken !== record.access_token) {
      return { success: false, code: 'FORBIDDEN', message: '无权访问该档案' };
    }

    const evRes = await db
      .collection('transport_events')
      .where({ record_id: record._id })
      .orderBy('event_no', 'asc')
      .limit(1000)
      .get();

    const events = evRes.data.map((e) => ({
      id: e._id,
      event_no: e.event_no,
      event_type: e.event_type,
      event_name: e.event_name,
      remark: e.remark || '',
      photo_count: e.photo_count || 0,
      created_at: e.created_at,
    }));

    return {
      success: true,
      data: {
        record: {
          _id: record._id,
          record_no: record.record_no,
          plate_number: record.plate_number,
          status: record.status,
          created_at: record.created_at,
          updated_at: record.updated_at,
          submitted_at: record.submitted_at || null,
        },
        events,
      },
    };
  } catch (e) {
    return { success: false, code: 'DB_ERROR', message: '查询失败，请重试' };
  }
};
