import { useEffect, useRef } from 'react'
import { fontFamily, resumeFontFamily, fonts, latinFonts, resumeSizes, uiSizes, type FontId, type LatinFontId, type TypographySettings, type TypographyTarget } from './typography'

interface TypographyProps {
  settings: TypographySettings
  change(patch: Partial<TypographySettings>): void
  reset(target: TypographyTarget): void
}

export function TypographyFields({ settings, change, reset, target, idPrefix }: TypographyProps & { target: TypographyTarget; idPrefix: string }) {
  const isUi = target === 'ui'
  const font = isUi ? settings.uiFont : settings.resumeFont
  return <fieldset className="typography-fields">
    <legend>{isUi ? '软件界面' : '简历文字'}</legend>
    <label htmlFor={idPrefix + '-font'}>{isUi ? '界面字体' : '简历中文字体'}</label>
    <select id={idPrefix + '-font'} value={font} onChange={(event) => change(isUi
      ? { uiFont: event.currentTarget.value as FontId } : { resumeFont: event.currentTarget.value as FontId })}>
      {fonts.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
    {!isUi && <><label htmlFor={idPrefix + '-latin-font'}>英文与数字字体</label>
      <select id={idPrefix + '-latin-font'} value={settings.resumeLatinFont} onChange={(event) => change({ resumeLatinFont: event.currentTarget.value as LatinFontId })}>
        {latinFonts.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></>}
    <label htmlFor={idPrefix + '-size'}>{isUi ? '界面文字大小' : '简历正文字号'}</label>
    <select id={idPrefix + '-size'} value={isUi ? settings.uiScale : settings.resumeSize} onChange={(event) => change(isUi
      ? { uiScale: Number(event.currentTarget.value) } : { resumeSize: Number(event.currentTarget.value) })}>
      {isUi ? uiSizes.map((size) => <option key={size.value} value={size.value}>{size.label}</option>)
        : resumeSizes.map((size) => <option key={size} value={size}>{size} pt</option>)}
    </select>
    <div className={'typography-sample ' + (isUi ? 'ui-sample' : 'resume-sample')}
      style={{ fontFamily: isUi ? fontFamily(font) : resumeFontFamily(settings.resumeFont, settings.resumeLatinFont), ...(isUi ? {} : { fontSize: settings.resumeSize + 'pt' }) }}
      aria-label={isUi ? '界面文字示例' : '简历文字示例'}>整理经历，让成果更清晰。<br />Python · CET-6 · 2026</div>
    {!isUi && <p className="typography-hint">英文与数字默认使用 Times New Roman；选中文字单独设置的字体优先。未安装的字体会采用近似字体。</p>}
    <button className="button" type="button" onClick={() => reset(target)}>{isUi ? '恢复界面默认' : '恢复简历默认'}</button>
  </fieldset>
}

export function TypographyDialog({ settings, change, reset, storageNotice, onClose }: TypographyProps & { storageNotice: string; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  return <dialog className="typography-dialog" ref={dialog} onCancel={onClose} aria-labelledby="typography-title" aria-describedby="typography-description">
    <div className="typography-dialog-heading"><h2 id="typography-title">文字设置</h2><button className="button" onClick={onClose} aria-label="关闭文字设置">关闭</button></div>
    <p id="typography-description">选择后立即生效并自动保存。界面和简历可以分别调整。</p>
    <div className="typography-columns">
      <TypographyFields settings={settings} change={change} reset={reset} target="ui" idPrefix="global-ui" />
      <TypographyFields settings={settings} change={change} reset={reset} target="resume" idPrefix="global-resume" />
    </div>
    <p className="typography-hint">使用当前设备的字体；未安装所选字体时，会采用近似字体。</p>
    {storageNotice && <p className="inline-error" role="alert">{storageNotice}</p>}
    <div className="button-row end-row"><button className="button primary" onClick={onClose}>完成</button></div>
  </dialog>
}
