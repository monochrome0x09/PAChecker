USE pachecker;

ALTER TABLE notification_settings
  DROP FOREIGN KEY fk_notification_settings_assessment;

ALTER TABLE notification_settings
  ADD CONSTRAINT fk_notification_settings_assessment
    FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE;

ALTER TABLE source_images
  DROP FOREIGN KEY fk_source_images_assessment;

ALTER TABLE source_images
  ADD CONSTRAINT fk_source_images_assessment
    FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE SET NULL;

ALTER TABLE ai_drafts
  DROP FOREIGN KEY fk_ai_drafts_source_image;

ALTER TABLE ai_drafts
  ADD CONSTRAINT fk_ai_drafts_source_image
    FOREIGN KEY (source_image_id) REFERENCES source_images(id) ON DELETE CASCADE;
