import {createRoot} from 'react-dom/client';
import App from './App';
import { TelaConfiguracaoAusente } from './TelaConfiguracaoAusente';
import { configuracao_supabase } from '@/lib/supabase';
import '@/styles/index.css';

createRoot(document.getElementById('root')!).render(
  configuracao_supabase.valida ? <App /> : <TelaConfiguracaoAusente problemas={configuracao_supabase.problemas} />,
);
