// Thin wrappers kept so existing imports keep working. The real logic lives in services/storage.service.js
import { deleteImage } from '../services/storage.service.js';

// Delete one stored image (Cloudinary URL or local "/uploads/..." path). Never throws.
export const removeUploadedFile = (stored) => deleteImage(stored);
export const removeUploadedFiles = (list = []) => Promise.all(list.map(deleteImage));
