/**
 * 人名拼装小工具（civ 的 PersonNamer 把姓与名拆成两个独立 API，
 * 不含"姓尾 ≠ 名首"守卫——同名首字会拼出「风风尧」这类结巴，
 * 这里在调用侧补上，与 Python 版 xianxia.person() 的口径一致）。
 */
import type { PersonNamer } from './persons'

/** 姓 + 名；带姓语感自动避开「姓尾 = 名首」的拼法。 */
export function personName(pn: PersonNamer, key: number): string {
  if (!pn.surnamed) return pn.given(key)
  const sur = pn.surname(key)
  const last = sur.slice(-1)
  for (let i = 0; i < 6; i++) {
    const g = pn.given(key + i * 7)
    if (g && !g.startsWith(last)) return sur + g
  }
  return sur + pn.given(key)
}
