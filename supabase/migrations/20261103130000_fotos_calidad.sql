-- Fotos del catálogo con más resolución (1440 px en el lado corto para la grande): sube el límite
-- por archivo del bucket de 600 KB a 1 MB. Safari no hace WebP y el JPEG de esa medida pesa más.

update storage.buckets set file_size_limit = 1048576 where id = 'catalogo';
