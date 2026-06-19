function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function estimateShareSlug(serviceType: string, ward: string | null): string {
  const typeSlug = slugify(serviceType);
  const wardSlug = ward ? slugify(ward) : 'citywide';
  return `${typeSlug}--${wardSlug}`;
}
