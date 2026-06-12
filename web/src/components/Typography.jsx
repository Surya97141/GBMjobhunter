const COLOR_CLASS = {
  secondary: 't-secondary',
  muted:     't-muted',
  accent:    't-accent',
  high:      't-high',
  mid:       't-mid',
  low:       't-low',
};

function makeVariant(baseClass, defaultTag, displayName) {
  function TypographyVariant({
    as: Tag = defaultTag,
    color,
    className = '',
    children,
    ...props
  }) {
    const colorClass = COLOR_CLASS[color] ?? '';
    const combined   = [baseClass, colorClass, className].filter(Boolean).join(' ');
    return (
      <Tag className={combined} {...props}>
        {children}
      </Tag>
    );
  }
  TypographyVariant.displayName = displayName;
  return TypographyVariant;
}

export const Hero       = makeVariant('t-hero',       'h1',   'Hero');
export const Display    = makeVariant('t-display',    'h2',   'Display');
export const Heading    = makeVariant('t-heading',    'h3',   'Heading');
export const Subheading = makeVariant('t-subheading', 'h4',   'Subheading');
export const Body       = makeVariant('t-body',       'p',    'Body');
export const Small      = makeVariant('t-small',      'p',    'Small');
export const Label      = makeVariant('t-label',      'span', 'Label');
export const Micro      = makeVariant('t-micro',      'span', 'Micro');
