-- Reviewers see who submitted a sample without gaining read access to the users
-- table: the first name is copied onto the review when the customer submits it.
ALTER TABLE nearpill.prescription_reviews
  ADD COLUMN customer_name varchar(80);
