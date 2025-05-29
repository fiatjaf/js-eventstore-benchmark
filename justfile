export PATH := "./node_modules/.bin:" + env_var('PATH')

run:
    vite build
    vite preview
