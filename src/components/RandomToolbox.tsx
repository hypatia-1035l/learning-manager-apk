import { useRef, useState } from 'react'
import { Swiper, SwiperSlide } from 'swiper/react'
import type { Swiper as SwiperClass } from 'swiper'
import 'swiper/css'
import { NumberRandomizer } from './random/NumberRandomizer'
import { ColorRandomizer } from './random/ColorRandomizer'
import { TextTools } from './random/TextTools'
import type { WordBank } from '../randomTypes'
import { WordBankRandomizer } from './random/WordBankRandomizer'
import { BankManager } from './random/BankManager'
import { RandomRecords } from './random/RandomRecords'
import { NameTool } from './random/NameTool'

type Tool = 'number' | 'color' | 'text' | 'wordbank' | 'name' | 'banks' | 'records'

const TABS: { id: Tool; label: string }[] = [
  { id: 'number', label: '数字' },
  { id: 'color', label: '颜色' },
  { id: 'text', label: '文本' },
  { id: 'wordbank', label: '词库' },
  { id: 'name', label: '起名' },
  { id: 'banks', label: '管理' },
  { id: 'records', label: '记录' },
]

export function RandomToolbox() {
  const [tool, setTool] = useState<Tool>('number')
  const swiperRef = useRef<SwiperClass | null>(null)
  // 选中的词库 ID（词库随机 / 词库管理 共享）
  const [selectedBankIds, setSelectedBankIds] = useState<string[]>([])
  // 送进文本工具的词库词条（管理页「加工」→ 文本工具）
  const [textPayload, setTextPayload] = useState<{ text: string; bankName: string; ts: number } | null>(null)
  const openInTextTools = (b: WordBank) => {
    setTextPayload({
      text: b.words.map((w) => w.text).join('\n'),
      bankName: b.name,
      ts: Date.now(),
    })
    setTool('text')
    swiperRef.current?.slideTo(toolIndex('text'))
  }

  const toolIndex = (id: Tool) => TABS.findIndex((t) => t.id === id)

  return (
    <div className="pool-compact">
      <div className="tabs rt-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tool === t.id ? 'active' : ''}`}
            onClick={() => {
              setTool(t.id)
              swiperRef.current?.slideTo(toolIndex(t.id))
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Swiper
        className="inner-tab-swiper"
        onSwiper={(s) => (swiperRef.current = s)}
        onSlideChange={(s) => {
          setTool(TABS[s.activeIndex].id)
        }}
        initialSlide={toolIndex(tool)}
      >
        <SwiperSlide>
          <div className="pool-scroll">
            <NumberRandomizer />
          </div>
        </SwiperSlide>
        <SwiperSlide>
          <div className="pool-scroll">
            <ColorRandomizer />
          </div>
        </SwiperSlide>
        <SwiperSlide>
          <div className="pool-scroll">
            <TextTools selectedBankIds={selectedBankIds} incoming={textPayload} />
          </div>
        </SwiperSlide>
        <SwiperSlide>
          <div className="pool-scroll">
            <WordBankRandomizer
              selectedIds={selectedBankIds}
              onSelectChange={setSelectedBankIds}
            />
          </div>
        </SwiperSlide>
        <SwiperSlide>
          <div className="pool-scroll">
            <NameTool />
          </div>
        </SwiperSlide>
        <SwiperSlide>
          <div className="pool-scroll">
            <BankManager
              selectedIds={selectedBankIds}
              onSelectChange={setSelectedBankIds}
              onOpenInTextTools={openInTextTools}
            />
          </div>
        </SwiperSlide>
        <SwiperSlide>
          <div className="pool-scroll">
            <RandomRecords />
          </div>
        </SwiperSlide>
      </Swiper>
    </div>
  )
}
