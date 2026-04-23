CREATE VIRTUAL TABLE IF NOT EXISTS zettels_fts USING fts5(
  zettel_id UNINDEXED,
  title,
  content_text,
  summary,
  category,
  tokenize = 'trigram'
);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
  task_id UNINDEXED,
  title,
  content,
  tokenize = 'trigram'
);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS people_fts USING fts5(
  person_id UNINDEXED,
  name,
  nickname,
  bio,
  core_value,
  tokenize = 'trigram'
);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
  media_id UNINDEXED,
  title,
  original_title,
  creator,
  review,
  tokenize = 'trigram'
);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS daily_logs_fts USING fts5(
  log_id UNINDEXED,
  date UNINDEXED,
  journal,
  meditation,
  gratitude,
  tokenize = 'trigram'
);
--> statement-breakpoint

INSERT INTO zettels_fts(zettel_id, title, content_text, summary, category)
SELECT z.id, z.title, coalesce(z.content_text, ''), coalesce(z.summary, ''), coalesce(z.category, '')
FROM zettels z
WHERE NOT EXISTS (SELECT 1 FROM zettels_fts f WHERE f.zettel_id = z.id);
--> statement-breakpoint
INSERT INTO tasks_fts(task_id, title, content)
SELECT t.id, t.title, coalesce(t.content, '')
FROM tasks t
WHERE NOT EXISTS (SELECT 1 FROM tasks_fts f WHERE f.task_id = t.id);
--> statement-breakpoint
INSERT INTO people_fts(person_id, name, nickname, bio, core_value)
SELECT p.id, p.name, coalesce(p.nickname, ''), coalesce(p.bio, ''), coalesce(p.core_value, '')
FROM people p
WHERE NOT EXISTS (SELECT 1 FROM people_fts f WHERE f.person_id = p.id);
--> statement-breakpoint
INSERT INTO media_fts(media_id, title, original_title, creator, review)
SELECT m.id, m.title, coalesce(m.original_title, ''), coalesce(m.creator, ''), coalesce(m.review, '')
FROM media_logs m
WHERE NOT EXISTS (SELECT 1 FROM media_fts f WHERE f.media_id = m.id);
--> statement-breakpoint
INSERT INTO daily_logs_fts(log_id, date, journal, meditation, gratitude)
SELECT d.id, d.date, coalesce(d.journal, ''), coalesce(d.meditation, ''), coalesce(d.gratitude, '')
FROM daily_logs d
WHERE NOT EXISTS (SELECT 1 FROM daily_logs_fts f WHERE f.log_id = d.id);
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS zettels_ai AFTER INSERT ON zettels BEGIN
  INSERT INTO zettels_fts(zettel_id, title, content_text, summary, category)
  VALUES (new.id, new.title, coalesce(new.content_text, ''), coalesce(new.summary, ''), coalesce(new.category, ''));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS zettels_ad AFTER DELETE ON zettels BEGIN
  DELETE FROM zettels_fts WHERE zettel_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS zettels_au AFTER UPDATE ON zettels BEGIN
  UPDATE zettels_fts
  SET title = new.title,
      content_text = coalesce(new.content_text, ''),
      summary = coalesce(new.summary, ''),
      category = coalesce(new.category, '')
  WHERE zettel_id = new.id;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(task_id, title, content)
  VALUES (new.id, new.title, coalesce(new.content, ''));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
  DELETE FROM tasks_fts WHERE task_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
  UPDATE tasks_fts
  SET title = new.title,
      content = coalesce(new.content, '')
  WHERE task_id = new.id;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS people_ai AFTER INSERT ON people BEGIN
  INSERT INTO people_fts(person_id, name, nickname, bio, core_value)
  VALUES (new.id, new.name, coalesce(new.nickname, ''), coalesce(new.bio, ''), coalesce(new.core_value, ''));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS people_ad AFTER DELETE ON people BEGIN
  DELETE FROM people_fts WHERE person_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS people_au AFTER UPDATE ON people BEGIN
  UPDATE people_fts
  SET name = new.name,
      nickname = coalesce(new.nickname, ''),
      bio = coalesce(new.bio, ''),
      core_value = coalesce(new.core_value, '')
  WHERE person_id = new.id;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS media_ai AFTER INSERT ON media_logs BEGIN
  INSERT INTO media_fts(media_id, title, original_title, creator, review)
  VALUES (new.id, new.title, coalesce(new.original_title, ''), coalesce(new.creator, ''), coalesce(new.review, ''));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS media_ad AFTER DELETE ON media_logs BEGIN
  DELETE FROM media_fts WHERE media_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS media_au AFTER UPDATE ON media_logs BEGIN
  UPDATE media_fts
  SET title = new.title,
      original_title = coalesce(new.original_title, ''),
      creator = coalesce(new.creator, ''),
      review = coalesce(new.review, '')
  WHERE media_id = new.id;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS daily_logs_ai AFTER INSERT ON daily_logs BEGIN
  INSERT INTO daily_logs_fts(log_id, date, journal, meditation, gratitude)
  VALUES (new.id, new.date, coalesce(new.journal, ''), coalesce(new.meditation, ''), coalesce(new.gratitude, ''));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS daily_logs_ad AFTER DELETE ON daily_logs BEGIN
  DELETE FROM daily_logs_fts WHERE log_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS daily_logs_au AFTER UPDATE ON daily_logs BEGIN
  UPDATE daily_logs_fts
  SET date = new.date,
      journal = coalesce(new.journal, ''),
      meditation = coalesce(new.meditation, ''),
      gratitude = coalesce(new.gratitude, '')
  WHERE log_id = new.id;
END;
