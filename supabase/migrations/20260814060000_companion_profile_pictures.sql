update public.social_companions as companion
set
  avatar_url = profile.avatar_url,
  updated_at = now()
from (
  values
    ('moss', '/companions/moss.webp'),
    ('tempo', '/companions/tempo.webp'),
    ('juniper', '/companions/juniper.webp'),
    ('north', '/companions/north.webp'),
    ('orbit', '/companions/orbit.webp'),
    ('sora', '/companions/sora.webp'),
    ('pixel', '/companions/pixel.webp'),
    ('ember', '/companions/ember.webp'),
    ('lumen', '/companions/lumen.webp'),
    ('kumo', '/companions/kumo.webp'),
    ('kage', '/companions/kage.webp'),
    ('akari', '/companions/akari.webp'),
    ('nova-reyes', '/companions/nova-reyes.webp'),
    ('zib', '/companions/zib.webp'),
    ('solara', '/companions/solara.webp'),
    ('brother-alden', '/companions/brother-alden.webp'),
    ('cipher', '/companions/cipher.webp'),
    ('mira-tomorrow', '/companions/mira-tomorrow.webp'),
    ('barnaby-wisp', '/companions/barnaby-wisp.webp'),
    ('rook', '/companions/rook.webp')
) as profile(slug, avatar_url)
where companion.slug = profile.slug;
