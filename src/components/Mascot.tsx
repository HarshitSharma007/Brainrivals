import { useId } from 'react';

export function Mascot({ kind = 'brain', className = '' }: { kind?: 'brain' | 'bot'; className?: string }) {
  const id = useId().replace(/:/g, '');
  return <svg className={className} viewBox="0 0 240 240" fill="none" role="img" aria-label={kind === 'brain' ? 'BrainRivals smiling brain mascot' : 'Friendly computer opponent'}>
    <defs><linearGradient id={`${id}a`} x1="30" y1="20" x2="200" y2="230" gradientUnits="userSpaceOnUse"><stop stopColor={kind === 'brain' ? '#d8bdff' : '#e6f6ae'} /><stop offset="1" stopColor={kind === 'brain' ? '#9270db' : '#a4c26b'} /></linearGradient><linearGradient id={`${id}b`} x1="70" y1="80" x2="170" y2="190" gradientUnits="userSpaceOnUse"><stop stopColor="#34304d"/><stop offset="1" stopColor="#17182b"/></linearGradient></defs>
    <ellipse cx="120" cy="222" rx="67" ry="9" fill="#000" opacity=".17"/>
    {kind === 'brain' ? <>
      <path d="M119 39C92 19 60 27 51 49C24 51 19 83 34 102C13 123 27 157 46 161C39 189 66 210 91 201C104 217 124 212 130 200C152 218 181 200 183 181C211 178 219 151 204 133C222 108 206 87 189 82C194 53 168 34 147 44C137 33 127 33 119 39Z" fill={`url(#${id}a)`}/>
      <path d="M73 50C52 57 53 80 65 88M38 109C52 103 67 112 65 127M48 161C57 146 72 151 78 161M95 200C88 183 99 173 106 173M119 43C111 57 113 66 119 75M156 55C174 58 176 73 167 83M188 96C171 94 162 104 165 115M189 149C177 140 162 150 164 165M143 202C151 188 139 180 136 179" stroke="#7551af" strokeOpacity=".42" strokeWidth="7" strokeLinecap="round"/>
      <ellipse cx="85" cy="124" rx="10" ry="14" fill="#282238"/><ellipse cx="147" cy="124" rx="10" ry="14" fill="#282238"/><circle cx="88" cy="120" r="3.5" fill="#fff"/><circle cx="150" cy="120" r="3.5" fill="#fff"/>
      <path d="M105 148Q119 162 132 146" stroke="#342440" strokeWidth="6" strokeLinecap="round"/><ellipse cx="68" cy="143" rx="11" ry="6" fill="#edabdb"/><ellipse cx="164" cy="141" rx="11" ry="6" fill="#edabdb"/>
      <path d="M69 207L58 216M162 207L174 215" stroke="#b696ec" strokeWidth="11" strokeLinecap="round"/>
    </> : <>
      <path d="M120 61V39" stroke="#cae398" strokeWidth="9" strokeLinecap="round"/><circle cx="120" cy="31" r="11" fill="#e8f5b4"/>
      <rect x="30" y="107" width="25" height="52" rx="12" fill="#9cbf66"/><rect x="185" y="107" width="25" height="52" rx="12" fill="#9cbf66"/>
      <rect x="43" y="62" width="154" height="141" rx="47" fill={`url(#${id}a)`}/>
      <rect x="60" y="87" width="120" height="80" rx="29" fill={`url(#${id}b)`}/>
      <path d="M79 122Q88 110 97 122M143 122Q152 110 161 122" stroke="#d7f29f" strokeWidth="7" strokeLinecap="round"/>
      <path d="M108 141Q120 151 132 141" stroke="#d7f29f" strokeWidth="5" strokeLinecap="round"/>
      <rect x="96" y="182" width="48" height="6" rx="3" fill="#7f9f4e"/><path d="M77 203V214M163 203V214" stroke="#c1db90" strokeWidth="14" strokeLinecap="round"/>
    </>}
    <path d="M207 43V61M198 52H216M24 180V192M18 186H30" stroke={kind === 'brain' ? '#dac0ff' : '#d8ec9c'} strokeWidth="3" strokeLinecap="round"/>
  </svg>;
}