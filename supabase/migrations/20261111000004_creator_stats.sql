-- Per-creator stats for the Creators page and Kevin's benchmark median.
create view creator_stats with (security_invoker = true) as
select c.id as creator_id,
       count(r.id) as reel_count,
       percentile_cont(0.5) within group (order by r.views) filter (where r.views is not null) as median_views,
       max(r.posted_at) as latest_reel_at
from creators c
left join reels r on r.creator_id = c.id
group by c.id;

-- Recreate the outlier view so it picks up the renamed thumbnail_path column and exposes creator tags
-- (used by the Outliers page tag filter). Same logic as 0002.
drop view reel_outliers;
create view reel_outliers with (security_invoker = true) as
with medians as (
  select creator_id,
         percentile_cont(0.5) within group (order by views) as median_views,
         count(*) as sample_size
  from reels
  where views is not null
  group by creator_id
)
select r.*,
       c.username, c.followers, c.is_benchmark, c.tags,
       m.median_views, m.sample_size,
       round((r.views / nullif(m.median_views,0))::numeric, 2) as outlier_score,
       round((r.views::numeric / nullif(c.followers,0)), 2)     as views_per_follower
from reels r
join creators c on c.id = r.creator_id
join medians m on m.creator_id = r.creator_id
where m.sample_size >= 10;            -- scores from fewer reels aren't reliable
