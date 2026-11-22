// cloudfunctions/submitRecord/index.js —— 提交运输档案
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
    if (record.access_token && accessToken !== record.access_token) {
      return { success: false, code: 'FORBIDDEN', message: '无权操作该档案' };
    }

    await db.collection('transport_records').doc(record._id).update({
      data: {
        status: 'submitted',
        submitted_at: db.serverDate(),
        updated_at: db.serverDate(),
      },
    });

    return { success: true, data: { record_no: recordNo, status: 'submitted' } };
  } catch (e) {
    return { success: false, code: 'DB_ERROR', message: '提交失败，请重试' };
  }
};
