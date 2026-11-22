---
title: "Depuração em larga escala: dez anos de implementação e experiência"
summary: O Windows Error Reporting (WER) é um serviço que coleta relatórios de falha e de travamento de cerca de um bilhão de máquinas, agrupa os relatórios em baldes (buckets) com heurísticas no cliente e no servidor, só coleta mais dados quando precisa e usa as estatísticas para decidir quais bugs corrigir primeiro. Este é o balanço de dez anos feito pela equipe da Microsoft.
researchArea: Engenharia de software
keywords: relatório de erros, bucketing, triagem de falhas, coleta progressiva de dados, depuração estatística, depuração post-mortem, minidump
version: 1.0
updatedAt: 2026-11-22
---

## Visão geral

Depurar um programa em uma máquina é uma rotina conhecida: reproduzir, anexar um depurador, ler o estado. O artigo parte da observação de que essa rotina para de funcionar quando o sistema tem centenas de componentes e milhões de instalações. Triar relatórios um a um não escala, a causa raiz se esconde entre muitos componentes, e o volume de relatórios até de um bug raro se torna esmagador. O Windows Error Reporting (WER) é a resposta da Microsoft, em uso desde 1999, e este artigo do SOSP 2009 descreve o projeto e o que dez anos de operação ensinaram à equipe.

A jogada central é tratar a escala como recurso, não como obstáculo. Tirar as pessoas do caminho crítico e aceitar milhões de relatórios deixa a lei dos grandes números fazer o resto: não é preciso ter todos os relatórios, só amostras suficientes para diagnosticar e correlacionar. Até um agrupamento errado se corrige sozinho, porque, depois de corrigido o primeiro bug, o segundo reaparece e domina as amostras seguintes. É um artigo de sistemas sobre um serviço em operação, não um experimento controlado, e deve ser lido assim.

## Contribuição

- **Bucketing.** Relatórios de erro com provável origem no mesmo bug são agrupados em um balde, com o ideal declarado de um bug por balde e um balde por bug. O agrupamento tem duas fases. Primeiro, a rotulagem no cliente atribui um primeiro balde a partir de evidência local (programa, módulo, deslocamento da instrução que falhou, código da exceção). Depois, a classificação no servidor move relatórios para outros baldes conforme chegam mais dados. O classificador é a extensão de depurador `!analyze`, com cerca de 100.000 linhas de código e umas 500 heurísticas, com aproximadamente uma heurística nova por semana.
- **Heurísticas de expansão e de condensação.** Uma heurística de expansão divide baldes para que dois bugs não dividam um. Uma de condensação junta baldes para que um bug não se espalhe por vários. O artigo diz que os dois tipos devem se complementar, não entrar em conflito.
- **Coleta progressiva de dados.** A maioria dos relatórios é só um identificador de balde. Se o serviço quer mais, pede um minidump (um despejo abreviado de pilha e memória), depois despejos mais amplos, processos relacionados, arquivos de log, chaves de registro ou consultas ao sistema. Programadores podem emitir um pedido de "dados desejados" para um balde.
- **Depuração baseada em estatísticas.** O banco central permite ordenar baldes por volume, achar causas ocultas comparando a frequência esperada e a observada de módulos, testar hipóteses contra milhares de despejos, medir o quanto uma correção foi implantada e vigiar regressões.
- **Direcionamento para soluções.** O serviço mantém um mapeamento de baldes para uma URL com a correção, de modo que o usuário que bate em um problema conhecido é levado à atualização.

## Metodologia

É um artigo de experiência. Os autores descrevem os algoritmos e a arquitetura e depois relatam medições do serviço em produção e de versões internas e beta de produtos da Microsoft. Não há comparação com um sistema alternativo nem estudo controlado. A seção de arquitetura cobre o protocolo de quatro estágios do cliente, o serviço e o armazenamento. A avaliação cobre escalabilidade, descoberta de bugs, a qualidade das heurísticas de bucketing e um conjunto de medidas agregadas sobre o uso por terceiros e a base instalada do Windows.

## Resultados

Os números abaixo vêm do texto. As figuras são gráficos e usei só valores escritos no texto.

- **Escala.** O WER coletou o primeiro milhão de relatórios em 8 meses desde a implantação em 1999 e bilhões desde então. De janeiro de 2003 a janeiro de 2009 o volume de relatórios cresceu por um fator de 30, contra 13 para o número de clientes que se conectam ao Windows Update. O serviço tem cerca de 60 servidores, uma rede de armazenamento de 65 TB para o banco de relatórios e outra de 120 TB para até 6 meses de arquivos de despejo brutos. Está dimensionado para bem mais de 100 milhões de relatórios por dia.
- **A coleta progressiva compensa.** No primeiro estágio do protocolo, uma página estática diz ao cliente se o serviço já tem dados suficientes, o que ocorre em mais de 90% dos relatórios. É isso que permite que um par de servidores de banco registre os erros de todas as máquinas Windows.
- **Exemplo de carga.** Em fevereiro de 2007 o malware Renos fez o shell travar em laço. Os relatórios foram de zero a quase 1,2 milhão por dia. Uma assinatura do Defender liberada em 27 de fevereiro os levou a menos de 100.000 em três dias.
- **Valor para corrigir bugs.** Os programadores do Windows Vista corrigiram mais de 5.000 bugs encontrados pelo WER nos betas, depois que análise estática e verificação de modelos tinham achado mais de 100.000. Nos dados de Windows, SQL, Office e Internet Explorer, um bug reportado pelo WER tem de 4,5 a 5,1 vezes mais chance de ser corrigido do que um reportado diretamente por uma pessoa.
- **Formato de Pareto.** O primeiro quartil dos relatórios está em bem menos de 1% dos baldes, e o último quartil se espalha por 88% a 93% deles. No Vista, os 500 maiores baldes concentram 65% dos relatórios, e 58% no Vista SP1, porque os maiores foram corrigidos.
- **Bugs raros passam a ser achados.** Em uma pré-versão do MSN Explorer com 3,6 milhões de usuários, menos de 0,18% dos usuários viram duas ou mais falhas em 30 dias. Com essa taxa, um laboratório nunca vê o bug, mas o WER achou bugs do Windows NT e do Office que existiam havia mais de cinco anos.
- **Causa oculta por estatística.** Em um caso, 96% das máquinas que reportavam um ponteiro inválido na infraestrutura de rastreamento rodavam um mesmo driver de terceiro, muito acima da fatia desse driver na população. O fornecedor achou o bug. Em outro, um fornecedor já conhecia um bug de processador, mas não sabia com que frequência ele ocorria até ver os dados do WER, e lançou uma correção de microcódigo.
- **Qualidade do bucketing.** Em uma amostra de 300 milhões de relatórios em 25 milhões de baldes, a heurística de rotulagem mais importante, de longe, foi `module_offset`. Como limite pessimista para as falhas de condensação, os autores assumem que todo balde com um único relatório está mal posicionado, já que bugs reais são atingidos mais de uma vez. Por esse limite, até 37% dos relatórios do PowerPoint na prévia interna do Office 2010 podem estar mal posicionados. A condensação excessiva é bem mais rara, e cada melhoria do `!analyze` é reexecutada sobre os minidumps de kernel guardados por seis meses.
- **Fornecedores melhoram.** Um fornecedor de código em modo kernel começou a usar o WER em maio de 2007 e, em cinco meses, sua fatia das falhas de kernel caiu de 7,6% para 3,8%.

## Análise crítica

A evidência é um histórico operacional de dez anos, escrito pela equipe que construiu o sistema. É rico, mas em grande parte observacional. Os autores explicam o fator de 4,5 a 5,1 dizendo que os relatórios do WER documentam o estado interno da computação, enquanto os humanos documentam sintomas externos, mas não controlam o tipo de bug que cada fonte encontra, e não há linha de base de um projeto que não usasse o WER. É uma correlação dentro do fluxo de trabalho de uma empresa.

Os pontos abaixo são uma leitura minha do artigo, não afirmações dele.

- **A contagem de baldes é uma métrica de qualidade que o artigo não consegue checar por completo.** A regra do "balde de um só relatório" é uma suposição declarada pelos autores, e um limite superior. Ela trata um balde com um relatório como erro do agrupamento, o que é plausível para falhas, mas é suposição, não medição. Os autores dizem que o projeto de bucketing ótimo continua em aberto.
- **As heurísticas estão ligadas a uma pilha específica.** A maior parte das 500 heurísticas depende de detalhes internos do Windows: quadros de pilha, módulos carregados, estado do pool do kernel. A ideia se transfere (agrupar por uma assinatura estável e refinar conforme chegam mais dados), mas as heurísticas em si não.
- **A privacidade se apoia mais em política do que em mecanismo.** O serviço zera identificadores conhecidos e minimiza a coleta de heap, mas afirma que não tem metadados para filtrar possíveis dados pessoais de pilhas e heap, e depende de consentimento informado e de política de acesso aos dados.
- **A visão de mundo é a de falhas que derrubam o programa.** Travamentos, falhas de instalação e asserções entram por código customizado. Falhas que não derrubam o programa, ou que dependem de estado distribuído, ficam fora do que um minidump consegue mostrar. Estudos que mineram rastreadores de bugs, como [What Bugs Live in the Cloud?](/papers/what-bugs-live-in-the-cloud-a-study-of-3000-issues-in-cloud-systems), veem as falhas que as pessoas escolheram relatar, uma amostra diferente da que o WER coleta automaticamente.

## Pesquisas futuras

- O artigo do DSN 2011 sobre crash graphs (Kim, Zimmermann e Nagappan) é descrito como voltado à classificação errada de falhas, que é a fraqueza apontada aqui. Não o li.
- Comparar rotular e depois classificar com a extração de templates de log, que resolve um problema parecido de agrupamento sobre texto, não sobre pilhas.
- Medir o quanto uma assinatura estável prevê uma única causa raiz fora de despejos de falha, por exemplo para mensagens que falham em uma fila ou jobs que falham em um pipeline.
- Reler a parte de privacidade à luz da regulação atual que se aplica a dados de diagnóstico coletados automaticamente.
