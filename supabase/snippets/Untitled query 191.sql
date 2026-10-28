INSERT INTO public.usuarios (id_usuario, email, nome, papel)
SELECT id, email, 'Admin Local', 'ADMIN' FROM auth.users WHERE email = 'edilson.kubota@ifms.edu.br'
ON CONFLICT (id_usuario) DO UPDATE SET papel = 'ADMIN';