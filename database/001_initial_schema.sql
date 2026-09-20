CREATE DATABASE IF NOT EXISTS pachecker
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE pachecker;

CREATE TABLE IF NOT EXISTS subjects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_subjects_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS assessments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subject_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  assessment_date DATE NOT NULL,
  description TEXT NULL,
  materials TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  extra_fields JSON NOT NULL DEFAULT ('{}'),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_assessments_subject_id (subject_id),
  KEY idx_assessments_date (assessment_date),
  CONSTRAINT fk_assessments_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notification_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  assessment_id BIGINT UNSIGNED NOT NULL,
  offset_days INT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_notification_settings_assessment_id (assessment_id),
  UNIQUE KEY uq_notification_settings_assessment_offset (assessment_id, offset_days),
  CONSTRAINT fk_notification_settings_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS source_images (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  assessment_id BIGINT UNSIGNED NULL,
  storage_key VARCHAR(512) NOT NULL,
  original_filename VARCHAR(255) NULL,
  mime_type VARCHAR(127) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_source_images_assessment_id (assessment_id),
  CONSTRAINT fk_source_images_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ai_drafts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_image_id BIGINT UNSIGNED NOT NULL,
  extracted_core JSON NOT NULL,
  extracted_extra_fields JSON NOT NULL DEFAULT ('{}'),
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  error_message TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ai_drafts_source_image_id (source_image_id),
  CONSTRAINT fk_ai_drafts_source_image FOREIGN KEY (source_image_id) REFERENCES source_images(id) ON DELETE CASCADE
) ENGINE=InnoDB;
