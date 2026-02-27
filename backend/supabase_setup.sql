-- 1. Create the profiles table
create table public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text,
  full_name text,
  avatar_url text,
  plan text default 'free',
  subscription_status text default 'inactive',
  stripe_customer_id text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Turn on Row Level Security
alter table public.profiles enable row level security;

-- 3. Allow users to read ONLY their own profile
create policy "Users can view own profile" on profiles
  for select using (auth.uid() = id);

-- 4. Allow the Stripe webhook (service role) to update profiles
create policy "Service role can update profiles" on profiles
  for update using (true);

-- 5. Create a trigger function to automatically create a profile when a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

-- 6. Attach the trigger to the auth.users table
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
