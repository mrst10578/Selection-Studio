export const MAX_DRAFT_QUESTIONS = 300;

export function ensureDraftCapacity(existing, additional = 1) {
  if (!Number.isSafeInteger(existing) || existing < 0 || !Number.isSafeInteger(additional) || additional < 1) {
    throw new RangeError('تعداد سؤال‌ها معتبر نیست.');
  }
  if (existing + additional > MAX_DRAFT_QUESTIONS) {
    throw new RangeError('حداکثر ۳۰۰ سؤال در هر پروژه OCR مجاز است. ابتدا پروژه فعلی را ذخیره کن یا سؤال‌های اضافی را حذف کن.');
  }
}
