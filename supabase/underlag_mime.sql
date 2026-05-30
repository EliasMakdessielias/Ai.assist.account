-- Tillåt fler bildformat (bl.a. HEIC från iPhone) i underlag-bucketen
update storage.buckets
set allowed_mime_types = array[
  'image/png','image/jpeg','image/jpg','image/webp','image/gif',
  'image/heic','image/heif','application/pdf'
]
where id = 'underlag';
