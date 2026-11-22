// cloudfunctions/createRecord/index.js —— 创建运输档案
// 职责：校验车牌 -> 生成唯一档案编号(TR+年月+4位序号) -> 生成 access_token -> 写入 transport_records
const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 北京时间年月 YYYYMM
function beijingYM() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 4) + d.toISOString().slice(5, 7);
}

// 生成唯一档案编号（事务保证序号连续；并发/异常时降级为时间戳，优先保证唯一）
async function genRecordNo() {
  const ym = beijingYM();
  try {
    const transaction = await db.startTransaction();
    const ref = transaction.collection('counters').doc('record_seq');

    let exists = true;
    let cur = null;
    try {
      const r = await ref.get();
      cur = r.data;
    } catch (e) {
      exists = false;
    }

    let seq;
    if (exists && cur && cur.year_month === ym) {
      seq = (cur.seq || 0) + 1;
    } else {
      seq = 1;
    }

    if (exists) {
      await ref.update({ data: { year_month: ym, seq } });
    } else {
      await ref.set({ data: { year_month: ym, seq } });
    }
    await transaction.commit();
    return 'TR' + ym + String(seq).padStart(4, '0');
  } catch (e) {
    // 事务失败兜底：时间戳后4位 + 2位随机，避免冲突
    const rand = String(Math.floor(Math.random() * 90) + 10);
    return 'TR' + ym + String(Date.now()).slice(-4) + rand;
  }
}

function genToken() {
  return crypto.randomBytes(16).toString('hex');
}

exports.main = async (event) => {
  const plateNumber = (event.plateNumber || '').trim().toUpperCase();
  if (!plateNumber) {
    return { success: false, code: 'INVALID_PLATE', message: '车牌号不能为空' };
  }

  const recordNo = await genRecordNo();
  const accessToken = genToken();

  try {
    const res = await db.collection('transport_records').add({
      data: {
        record_no: recordNo,
        plate_number: plateNumber,
        status: 'active', // 进行中
        created_at: db.serverDate(),
        updated_at: db.serverDate(),
        submitted_at: null,
        access_token: accessToken,
        photo_count: 0,
        event_count: 0,
      },
    });

    return {
      success: true,
      data: {
        _id: res._id,
        record_no: recordNo,
        plate_number: plateNumber,
        status: 'active',
        access_token: accessToken,
      },
    };
  } catch (e) {
    return { success: false, code: 'DB_ERROR', message: '创建档案失败，请重试' };
  }
};
