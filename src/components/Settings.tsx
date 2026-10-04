// 设置页 —— 系统配置入口：说明 / 数据备份 / 版本信息
// 提醒设置已移至「方向」页工具栏的「提醒」按钮弹窗
import { useState } from 'react'
import { BUILD_VERSION, BUILD_TIME } from '../buildInfo'
import { useSwipeBack } from '../useSwipeBack'
import { useAppData } from '../store'
import { AppListSettings } from './AppListSettings'
import { GuardSettings } from './GuardSettings'

interface Props {
  onOpenBackup: () => void
}

export function Settings({ onOpenBackup }: Props) {
  // 设置主页 / 说明子页 / 应用名单子页
  const [view, setView] = useState<'main' | 'help' | 'apps'>('main')
  // 越界提醒设置弹窗（Modal，形态与提醒设置一致）
  const [showGuard, setShowGuard] = useState(false)
  const data = useAppData()
  const appCount = (data.appPool ?? []).length

  // 子页右滑返回设置主页（在主列表页右滑为无操作，无副作用）
  useSwipeBack(() => setView('main'))

  if (view === 'apps') {
    return <AppListSettings onBack={() => setView('main')} />
  }

  if (view === 'help') {
    return (
      <div className="pool-compact">
        <header className="shell-header">
          <button className="back-link" onClick={() => setView('main')}>
            ← 返回
          </button>
        </header>
        <HelpContent />
      </div>
    )
  }

  return (
    <div className="pool-compact">
      <header className="shell-header">
        <h1 className="app-title">今天摸啥鱼</h1>
      </header>
      <div className="settings-list">
        <button className="settings-item" onClick={() => setView('help')}>
          <span className="si-left">
            <span>
              <div className="si-name">说明</div>
              <div className="si-desc">各页填写与功能</div>
            </span>
          </span>
          <span className="si-arrow">›</span>
        </button>
        <button className="settings-item" onClick={() => setView('apps')}>
          <span className="si-left">
            <span>
              <div className="si-name">应用名单</div>
              <div className="si-desc">
                {appCount > 0 ? `已记录 ${appCount} 个应用` : '给方向配可直达的应用'}
              </div>
            </span>
          </span>
          <span className="si-arrow">›</span>
        </button>
        <button className="settings-item" onClick={() => setShowGuard(true)}>
          <span className="si-left">
            <span>
              <div className="si-name">越界提醒</div>
              <div className="si-desc">
                {data.reminder?.guardEnabled ? '计时期间检测跑偏' : '计时期间检测跑偏（已关）'}
              </div>
            </span>
          </span>
          <span className="si-arrow">›</span>
        </button>
        <button className="settings-item" onClick={onOpenBackup}>
          <span className="si-left">
            <span>
              <div className="si-name">数据备份</div>
              <div className="si-desc">导出 / 导入</div>
            </span>
          </span>
          <span className="si-arrow">›</span>
        </button>
      </div>

      <section className="section" style={{ marginTop: 20 }}>
        <div className="section-title">版本信息</div>
        <div className="obj-list">
          <div className="obj-item">
            <span className="name">v{BUILD_VERSION}</span>
            <div className="ops" />
            <span className="prog">{BUILD_TIME}</span>
          </div>
        </div>
      </section>

      {showGuard && <GuardSettings onClose={() => setShowGuard(false)} />}
    </div>
  )
}

function HelpContent() {
  return (
    <div style={{ paddingBottom: 24 }}>
      <div className="section">
        <div className="section-title">方向（新建 / 编辑）</div>
        <ul className="help-list">
          <li><b>提醒星期</b>：参与次日计划的星期，默认每天。</li>
          <li><b>序列名</b>：每行一条，可带 名称｜目标｜单位｜分钟；也支持空格分隔（如 卷三 80 篇 25）与逗号/顿号拆分纯名称；可用数字序列生成。</li>
          <li><b>目标 / 单位 / 倒计时</b>：所有序列共用的默认参数。</li>
          <li><b>进度节点</b>：每行「数字 名称」，标记进度的刻度（如 0 入门）。</li>
        </ul>
      </div>

      <div className="section">
        <div className="section-title">应用名单</div>
        <ul className="help-list">
          <li><b>允许的应用</b>：只给这些应用入口。计时页会出现它们的图标，点一下直接进入；不在名单里的一律不给入口（默认禁止）。</li>
          <li><b>分心的应用</b>：本方向明确要躲开的。同样不给入口，列出来是为了让越界提醒逮到时更严厉。</li>
          <li><b>设置 → 应用名单</b>：只是应用的名字缓存，可看每个应用被哪些方向引用，把不用的清掉。</li>
          <li><b>注意</b>：不给入口不等于打不开——从桌面仍能启动别的应用，系统层面拦不住（除非装无障碍服务，本项目不做）。</li>
        </ul>
      </div>

      <div className="section">
        <div className="section-title">方向详情（内容序列）</div>
        <ul className="help-list">
          <li><b>序列名 / 单位 / 目标 / 倒计时</b>：添加一条序列时的参数。</li>
          <li><b>进度</b>：当前已完成的进度值。</li>
          <li><b>时长</b>：单次计时分钟数，可点快捷或自填。</li>
          <li><b>进度节点</b>：同新建时的含义。</li>
        </ul>
      </div>

      <div className="section">
        <div className="section-title">计划</div>
        <ul className="help-list">
          <li><b>内容</b>：这条计划要做什么。</li>
          <li><b>时刻</b>：可指定今天的提醒时刻，留空则随机插入未来时段。</li>
          <li><b>开始</b>：加入计划并立即计时。</li>
          <li><b>加入计划</b>：按所选时刻加入今日计划等提醒。</li>
          <li><b>顺延</b>：手动建的计划每天自动带入当天列表，直到完成/跳过/删除。</li>
          <li><b>仅提醒</b>：勾选后到点只提醒不计时，在计划页点「完成」即可；左滑可跳过或删除。</li>
        </ul>
      </div>

      <div className="section">
        <div className="section-title">学习结束</div>
        <ul className="help-list">
          <li><b>本次完成</b>：填本次完成的数量，达到目标自动完成。</li>
          <li><b>当前位置</b>：填当前进度位置，如 卷八十九 / 第12集。</li>
          <li><b>快速到节点</b>：序列设了进度节点时，结束页可点节点一键把进度补到该刻度。</li>
          <li><b>计时太短</b>：不足 5 秒就保存会先确认，只能放弃或继续，避免误触产生垃圾记录。</li>
          <li><b>备注</b>：随手记想法、疑问、心得。</li>
        </ul>
      </div>

      <div className="section">
        <div className="section-title">提醒设置</div>
        <ul className="help-list">
          <li><b>方向数</b>：每天随机排几个方向（1–12）。</li>
          <li><b>强度</b>：通知如何打扰你。</li>
          <li><b>节奏</b>：间隔=固定间隔分钟；最小间隔=两计划间最短间隔；跳过=学完后一段时间内不排新计划项。</li>
          <li><b>时间段</b>：提醒生效时段，最多 4 段，支持跨夜。</li>
          <li><b>精确闹钟</b>：未授权会导致提醒漂移 / 不准时，需在系统设置开启。</li>
        </ul>
      </div>

      <div className="section">
        <div className="section-title">词库</div>
        <ul className="help-list">
          <li><b>词库名 / 分类 / 标签</b>：新建词库的属性，标签用逗号或空格分隔。</li>
          <li><b>词条 / 权重</b>：权重 &gt; 1 提高抽中概率。</li>
          <li><b>JSON</b>：粘贴单词库或全量备份格式导入，按名称去重、不覆盖已有。</li>
          <li><b>批量</b>：每行一词，逗号分隔，或 词｜权重 带权重。</li>
        </ul>
      </div>

      <div className="section">
        <div className="section-title">文本工具</div>
        <ul className="help-list">
          <li><b>整理</b>：去重 / 排序 / 倒序 / 去空行 / 去首尾空格，就地按行处理，可连续叠加。</li>
          <li><b>前后缀</b>：给每个非空行批量加前缀/后缀。</li>
          <li><b>分隔符互转</b>：按字符拆成多行（可勾选空格也算分隔符），或把所有行合并成一行。</li>
          <li><b>加空格</b>：给无标点的连写文字插空格——按固定字数，或按词库页选中的词库切词。</li>
          <li><b>存回词库</b>：管理页点「加工」把词库送来，加工完覆盖或追加写回；同名词条跳过。</li>
          <li><b>去重</b>：可勾选忽略大小写。</li>
          <li><b>复制全部</b>：加工完一键复制走。</li>
        </ul>
      </div>

      <div className="section">
        <div className="section-title">数字随机</div>
        <ul className="help-list">
          <li><b>最小值 / 最大值</b>：随机范围。</li>
          <li><b>小数位</b>：0–10，0 为整数。</li>
          <li><b>抽取数量</b>：一次抽几个（1–50）。</li>
          <li><b>名称</b>：把当前范围存为常用。</li>
        </ul>
      </div>

      <div className="section">
        <div className="section-title">数据备份</div>
        <ul className="help-list">
          <li><b>导出</b>：把用户数据打包成 JSON 下载。</li>
          <li><b>导入</b>：选之前导出的 JSON，会替换当前所有数据，请确认来源可信。</li>
        </ul>
      </div>
    </div>
  )
}
