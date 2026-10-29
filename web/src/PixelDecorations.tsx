const dog = [
  '..t......t..',
  '.ttt....ttt.',
  '.tDt....tDt.',
  '..tttttttt..',
  '.tDDDDDDDDt.',
  '.tDCCDDCCDt.',
  '.tDDDDDDDDt.',
  '..tDDDDDDt..',
  '...tDDDDDt...',
  '...tD..Dt....',
  '...tt..tt....',
  '......p......',
]

const colors: Record<string, string> = {
  t: '#B97844',
  D: '#3F4944',
  C: '#F2D9A5',
  p: '#CB756B',
}

export function PixelForestCompanion() {
  return (
    <svg className="pixel-companion" viewBox="0 0 20 16" role="img" aria-label="森林里的像素小狗与橡果" shapeRendering="crispEdges">
      <g transform="translate(1 2)">
        {dog.flatMap((row, y) => [...row].map((pixel, x) => pixel === '.' ? null :
          <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={colors[pixel]} />))}
      </g>
      <g transform="translate(15 3)">
        <rect x="1" y="0" width="3" height="1" fill="#7D8B82" />
        <rect x="0" y="1" width="5" height="3" fill="#A7B0A8" />
        <rect x="1" y="4" width="3" height="1" fill="#7D8B82" />
        <rect x="2" y="5" width="1" height="2" fill="#707C74" />
        <rect x="7" y="5" width="2" height="1" fill="#8E6740" />
        <rect x="6" y="6" width="4" height="3" fill="#BD8750" />
        <rect x="7" y="9" width="2" height="1" fill="#8E6740" />
        <rect x="6" y="5" width="4" height="1" fill="#707C74" />
      </g>
    </svg>
  )
}
