-- Outlier view (BUILD_GUIDE.md Section 5)
-- security_invoker makes the view respect RLS on reels/creators.
-- Without it the view runs as its owner and anyone with the public anon key can read it.
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
       c.username, c.followers, c.is_benchmark,
       m.median_views, m.sample_size,
       round((r.views / nullif(m.median_views,0))::numeric, 2) as outlier_score,
       round((r.views::numeric / nullif(c.followers,0)), 2)     as views_per_follower
from reels r
join creators c on c.id = r.creator_id
join medians m on m.creator_id = r.creator_id
where m.sample_size >= 10;            -- scores from fewer reels aren't reliable
