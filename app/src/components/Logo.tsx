// Símbolo de OpenPL: base de datos con la tapa abierta (design/logo/final).

interface Props {
  size?: number;
  color?: string;
  title?: string;
}

/** Hasta 24 px se usa el corte simplificado (dos discos), que no se empasta. */
export function Logo({ size = 18, color, title = "OpenPL" }: Props) {
  const small = size <= 24;
  return (
    <svg
      role="img"
      aria-label={title}
      width={size}
      height={size}
      viewBox="0 0 256 256"
      style={{ color: color ?? "var(--accent)", flexShrink: 0 }}
    >
      {small ? (
        <g transform="translate(0 5)">
          <path fill="currentColor" fillRule="evenodd" d="M40 54a88 32 0 1 0 176 0a88 32 0 1 0-176 0ZM64 54a64 12 0 1 0 128 0a64 12 0 1 0-128 0Z" />
          <path fill="currentColor" d="M40 104V140A88 28 0 0 0 216 140V104A88 28 0 0 1 40 104Z" />
          <path fill="currentColor" d="M40 166V196A88 28 0 0 0 216 196V166A88 28 0 0 1 40 166Z" />
        </g>
      ) : (
        <>
          <path fill="currentColor" fillRule="evenodd" d="M48 48a80 25 0 1 0 160 0a80 25 0 1 0-160 0ZM62 48a66 11 0 1 0 132 0a66 11 0 1 0-132 0Z" />
          <path fill="currentColor" d="M48 80V114A80 24 0 0 0 208 114V80A80 24 0 0 1 48 80Z" />
          <path fill="currentColor" d="M48 133V167A80 24 0 0 0 208 167V133A80 24 0 0 1 48 133Z" />
          <path fill="currentColor" d="M48 186V208A80 24 0 0 0 208 208V186A80 24 0 0 1 48 186Z" />
        </>
      )}
    </svg>
  );
}
