import { useState, type CSSProperties } from 'react'
import type { CareerDraft } from './careerDraft'
import { sectionTitles } from './jobMatching'
import { PixelIcon, type PixelIconName } from './PixelIcon'
import { resumeSectionHtml, sanitizeResumeHtml } from './resumeFormatting'
import { suggestResumeJobTitle } from './resumeExport'
import { resumeFontFamily, type TypographySettings } from './typography'
import type { Experience, PageId } from './types'
import './HomeDashboard.css'

interface Props {
  experiences: Experience[]
  skillCount: number
  draft: CareerDraft
  photoUrl: string
  cloudMode: boolean
  typography?: Pick<TypographySettings, 'resumeFont' | 'resumeLatinFont' | 'resumeSize'>
  onNavigate(page: PageId): void
  onCreateExperience(): void
}

/** A presentation of the existing archive and current draft; no data is written here. */
export function HomeDashboard({ experiences, skillCount, draft, photoUrl, cloudMode, typography, onNavigate, onCreateExperience }: Props) {
  const [recentOpen, setRecentOpen] = useState(false)
  const recent = [...experiences].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3)
  const title = draft.target.trim() || suggestResumeJobTitle(draft.resumeJob ?? draft.matchedJob) || '岗位简历'
  const statistics: { label: string; value: string; icon: PixelIconName }[] = [
    { label: '项目与实践', value: count(experiences.filter((item) => ['项目', '实习', '实践'].includes(item.type)).length), icon: 'project' },
    { label: '科研经历', value: count(experiences.filter((item) => item.type === '科研').length), icon: 'research' },
    { label: '技能标签', value: count(skillCount), icon: 'skill' },
    { label: '简历草稿', value: draft.generated ? '01' : '00', icon: 'resume' },
  ]
  const font = typography ? resumeFontFamily(typography.resumeFont, typography.resumeLatinFont) : '"Times New Roman", SimSun, serif'
  const previewStyle = { '--glass-resume-font': font, '--glass-resume-size': `${typography?.resumeSize ?? 11}pt` } as CSSProperties

  return <section className="glass-home" aria-labelledby="glass-home-title">
    <div className="glass-home-main">
      <div className="glass-home-welcome">
        <p className="glass-home-eyebrow">YOUR NEXT CHAPTER</p>
        <h1 id="glass-home-title">整理经历，准备下一次机会</h1>
        <p className="glass-home-lead">把每段经历，写成有依据的表达。</p>
        <div className="glass-home-actions">
          <button type="button" className="button primary glass-home-primary" onClick={() => onNavigate('match')}>开始岗位匹配<PixelIcon name="arrow" /></button>
          <button type="button" className="button glass-home-secondary" onClick={() => onNavigate('resume')}>编辑简历</button>
        </div>
      </div>

      <div className="glass-home-stats" aria-label="档案概览">
        {statistics.map(({ label, value, icon }) => <div className="glass-home-stat" key={label}>
          <PixelIcon name={icon} /><span>{label}</span><strong>{value}</strong>
        </div>)}
      </div>

      <div className="glass-home-recent">
        <button type="button" className={'glass-home-recent-disclosure' + (recentOpen ? ' is-open' : '')} aria-expanded={recentOpen} aria-controls="glass-home-more-experiences" onClick={() => setRecentOpen((value) => !value)}>
          <span><PixelIcon name="archive" />最近整理的经历</span><span className="glass-home-recent-toggle">{recentOpen ? '收起' : '展开'}<PixelIcon name="chevron" /></span>
        </button>
        {recent[0] ? <div className="glass-home-latest"><RecentExperience item={recent[0]} onOpen={() => onNavigate('archive')} /></div>
          : <div className="glass-home-no-records"><span>从一段经历开始，慢慢整理你的成长。</span><button type="button" className="text-link" onClick={onCreateExperience}>新增经历<PixelIcon name="plus" /></button></div>}
        <div id="glass-home-more-experiences" hidden={!recentOpen}>
          {recent.length > 1 && <div className="glass-home-more-records">{recent.slice(1).map((item) => <RecentExperience key={item.id} item={item} onOpen={() => onNavigate('archive')} />)}</div>}
          <button type="button" className="text-link glass-home-view-all" onClick={() => onNavigate('archive')}>查看全部经历<PixelIcon name="chevron" /></button>
        </div>
      </div>

      <div className="glass-home-quick">
        <h2>快捷操作</h2>
        <div className="glass-home-quick-list">
          <button type="button" onClick={onCreateExperience}><PixelIcon name="plus" /><span>新增经历</span><PixelIcon name="chevron" /></button>
          <button type="button" onClick={() => onNavigate('files')}><PixelIcon name="file" /><span>上传附件</span><PixelIcon name="chevron" /></button>
          <button type="button" onClick={() => onNavigate('applications')}><PixelIcon name="applications" /><span>查看投递</span><PixelIcon name="chevron" /></button>
        </div>
      </div>
    </div>

    <aside className="glass-home-resume-card" aria-labelledby="glass-home-resume-title">
      <div className="glass-home-resume-heading"><h2 id="glass-home-resume-title">继续编辑</h2><PixelIcon name="more" /></div>
      <div className={'glass-home-preview-window' + (draft.generated ? '' : ' is-empty')} style={previewStyle} aria-label={draft.generated ? '当前简历缩略预览' : '尚未生成岗位简历'}>
        {draft.generated ? <div className="glass-home-mini-page" aria-hidden="true">
          <header><div><h3>{draft.name || '未填写姓名'}</h3><p>{draft.contact}</p></div>{photoUrl && <img src={photoUrl} alt="" />}</header>
          {sectionTitles.filter((section) => draft.visible[section] && (draft.sections[section]?.trim() || draft.richSections?.[section])).map((section) => <section key={section}>
            <h4>{draft.sectionNames?.[section] ?? section}</h4>
            <div dangerouslySetInnerHTML={{ __html: sanitizeResumeHtml(resumeSectionHtml(section, draft.sections[section] ?? '', draft.richSections?.[section])) }} />
          </section>)}
        </div> : <div className="glass-home-preview-empty"><PixelIcon name="resume" /><strong>你的下一份简历</strong><p>从目标岗位出发<br />让每段经历有据可循</p><div aria-hidden="true"><i /><i /><i /><i /></div></div>}
      </div>
      <div className="glass-home-resume-caption"><strong>{draft.generated ? title : '为下一次机会做好准备'}</strong><p>{draft.generated ? cloudMode ? '账号空间中的当前草稿' : '当前设备中的简历草稿' : '匹配岗位后，在这里继续编辑'}</p></div>
      <button type="button" className="button primary glass-home-open-resume" onClick={() => onNavigate(draft.generated ? 'resume' : 'match')}>{draft.generated ? '打开简历' : '开始准备'}<PixelIcon name="arrow" /></button>
    </aside>
  </section>
}

function count(value: number) { return String(value).padStart(2, '0') }

function RecentExperience({ item, onOpen }: { item: Experience; onOpen(): void }) {
  return <button type="button" className="glass-home-record" onClick={onOpen}>
    <PixelIcon name={item.type === '科研' ? 'research' : 'project'} />
    <span className="glass-home-record-copy"><span className="glass-home-record-title"><strong>{item.title}</strong><small>{item.type}</small></span><span className="glass-home-record-summary">{item.summary || item.outcome || [item.organization, item.role].filter(Boolean).join(' · ') || '继续补充职责、行动和成果'}</span></span>
    <span className="glass-home-record-period">{item.period}</span><PixelIcon name="chevron" />
  </button>
}
