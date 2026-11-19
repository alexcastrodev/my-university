---
title: "Núcleos que não contam"
summary: Artigo de posição do HotOS, do Google, que dá nome aos "mercurial cores", núcleos de CPU que passam nos testes de fabricação mas calculam errado em silêncio, descreve a evidência anedótica que os autores têm e esboça pesquisas sobre detecção, isolamento e mitigação em software e em hardware.
researchArea: Sistemas operacionais
keywords: núcleos mercuriais, corrupção silenciosa de dados, erros de execução corrompida, fail-stop, triagem de núcleos, tolerância a falhas, artigo de posição
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Estamos acostumados a pensar nos computadores como fail-stop, especialmente nos núcleos que executam instruções, e a maior parte do software de sistema depende implicitamente dessa suposição. Durante boa parte da era VLSI, processadores que passavam nos testes de fabricação e operavam dentro das especificações nos protegeram dessa ficção. À medida que a fabricação avança para transistores menores e estruturas computacionais mais elaboradas, e que pares cada vez mais especializados de instrução e silício são introduzidos para ganhar desempenho, observamos erros computacionais efêmeros que não foram detectados nos testes de fabricação. Esses defeitos nem sempre podem ser mitigados por técnicas como atualizações de microcódigo, e podem estar ligados a componentes específicos do processador, de modo que pequenas mudanças de código causam grandes variações de confiabilidade. Pior, essas falhas costumam ser "silenciosas": o único sintoma é uma computação errada.

Chamamos de "mercurial" um núcleo que desenvolve esse comportamento. Núcleos mercuriais são extremamente raros, mas em uma grande frota de servidores podemos observar o transtorno que causam, com frequência suficiente para vê-los como um problema distinto, que exigirá colaboração entre projetistas de hardware, fabricantes de processadores e arquitetos de software de sistema.

Este artigo é uma chamada à ação por um novo foco na pesquisa em sistemas: especulamos sobre várias abordagens em software para os núcleos mercuriais, de melhores mecanismos de detecção e isolamento a métodos para tolerar a corrupção silenciosa de dados que eles causam.

## Visão geral

A maioria do software de sistema supõe que uma CPU calcula corretamente ou para. Este artigo, de autores do Google no HotOS '21 (8 páginas), diz que essa suposição falhou em silêncio: alguns núcleos continuam rodando e devolvem respostas erradas, para certas instruções, sem nenhum sinal. Os autores chamam esses casos de "corrupt execution errors" (CEEs) e os núcleos de "mercurial". O artigo abre com um pipeline de análise de dados que passou a dar respostas erradas depois que uma mudança inocente em uma biblioteca fez os servidores usarem mais instruções raramente usadas, e apenas poucas máquinas eram responsáveis.

É um artigo de posição, não um estudo de medição. Os autores dizem que não podem revelar as taxas exatas de CEE por razões de negócio. Armazenamento e redes há muito têm redundância contra corrupção (ECC, checksums, CRCs), e o artigo explica por que a computação é mais difícil: no armazenamento a resposta certa é a função identidade, enquanto conferir uma computação parece custar o dobro de trabalho, ou o triplo para corrigir.

Artigos relacionados do catálogo: [Practical Byzantine Fault Tolerance](/papers/practical-byzantine-fault-tolerance) é citado como uma abordagem geral que pode servir para CEEs em alguns casos. O posterior [Silent Data Corruptions in a Large Production CPU Population](/papers/silent-data-corruptions-in-a-large-production-cpu-population) (SOSP 2023, Alibaba Cloud) mede o problema, e o [Orthrus](/papers/orthrus-detecting-silent-user-data-corruption-in-the-cloud) constrói um detector online. Os dois são posteriores a este artigo e não fazem parte das suas afirmações.

## Contribuição

- **Um nome e um enquadramento.** CEEs são uma causa de corrupção silenciosa de dados (SDC), não só um sintoma. A SDC era atribuída sobretudo a partículas alfa, raios cósmicos e overclocking, e o artigo propõe CEEs de alta taxa como uma nova causa.
- **Uma taxonomia de impacto,** em ordem crescente de risco: respostas erradas detectadas na hora (retry possível), machine checks, respostas erradas detectadas tarde demais para repetir e respostas erradas nunca detectadas. Metadados ruins podem perder um sistema de arquivos inteiro, e uma chave de criptografia corrompida pode tornar grandes volumes de dados permanentemente inacessíveis.
- **Uma discussão de causas e métricas,** admitindo que os autores não conseguem inferir causas-raiz sem as estruturas de teste do hardware e que faltam boas métricas.
- **Uma agenda de pesquisa:** detecção e isolamento, mitigação em software, mitigação em hardware e acesso para pesquisadores que não são hyperscalers.

## Metodologia

Não há método experimental. A evidência é a experiência operacional dos autores: incidentes de produção, evidência de core dumps e um "modesto corpus" de código de teste (trechos reais, bibliotecas de compressão, hash, matemática, criptografia, cópia, locking, fork e chamadas de sistema, e testes de fabricantes), escolhido por intuição, sem um método sistemático para criar mais. Eles controlam qual código roda em qual núcleo e controlam em parte frequência, voltagem e temperatura (f, V, T). A única figura é a taxa de incidentes de CEE por máquina, reportados por usuários e pelo detector automático, normalizada para uma linha de base arbitrária.

## Resultados

São afirmações do artigo, quase todas observacionais.

- **Taxa.** "Da ordem de alguns núcleos mercuriais por vários milhares de máquinas", que os autores dizem ser semelhante à taxa relatada pelo Facebook, com "muitas décadas de engenharia" já dedicadas. Nenhum número exato e nenhum tamanho de frota são dados.
- **Características.** CEEs costumam afetar núcleos específicos, não o chip inteiro, e normalmente um núcleo de uma CPU multicore. As falhas são em geral não determinísticas, se repetem de forma intermitente, muitas vezes pioram com o tempo, e os autores têm "alguma evidência" de que o envelhecimento é um fator. Aparecem em vários fabricantes, mas não na mesma taxa, e as taxas variam por muitas ordens de grandeza. Dependem da carga de trabalho e de f, V, T: alguns núcleos são sensíveis à frequência, outros não, e uma frequência menor às vezes aumenta a taxa de falha, de forma surpreendente. Em mais de um caso, um defeito de cópia de dados e um de operação vetorial usavam a mesma lógica de hardware.
- **Exemplos.** Violações da semântica de locks; corrupção em operações de load, store, vetoriais e de coerência; uma computação AES errada e determinística que era "autoinversa" (cifrar e decifrar no mesmo núcleo dava a identidade, decifrar em outro dava lixo); corrupção na coleta de lixo de um sistema de armazenamento que perdeu dados vivos; corrupção de índice de banco de dados conforme a réplica que atendia a consulta; bit-flips repetidos na mesma posição de bit em strings; estado corrompido do kernel causando crashes.
- **Triagem.** Cerca de metade dos suspeitos identificados por humanos se mostra de fato núcleo mercurial. Relatos concentrados em poucos núcleos apontam para CEEs, relatos espalhados por igual provavelmente não. A taxa do detector automático vem crescendo aos poucos, mas os autores não sabem se a taxa subjacente mudou.
- **Por que agora.** Frotas maiores, mais atenção à confiabilidade, menos bugs de software e, segundo os autores, transistores menores e projetos mais complexos que pressionam os testes de fabricação.

## Análise crítica

- **A evidência é anedótica.** A única quantidade é uma faixa ("alguns por vários milhares de máquinas") e um gráfico normalizado, sem tamanho de frota, denominador, cobertura de testes ou confiança. O próprio artigo diz que o entendimento é "primariamente empírico". Vale notar que o texto fala em vários milhares de máquinas, não em alguns por mil.
- **As alegações de detecção não são avaliadas.** As ideias de triagem, o serviço RPC para reportar suspeitos e as bibliotecas com autoverificação são descritos, não medidos. Os autores também admitem que o corpus de testes não é sistemático.
- **Literatura posterior.** A taxa e as causas que este artigo não pôde dar foram abordadas em [Silent Data Corruptions in a Large Production CPU Population](/papers/silent-data-corruptions-in-a-large-production-cpu-population), um estudo posterior e bem maior no Alibaba Cloud (literatura depois deste artigo, não algo que ele afirma). Os números dele não são comparados aqui.

## Pesquisas futuras

- Detectar modos de defeito novos e registrar evidência forense na frota, com teste em todo o ciclo de vida da CPU (antes e depois da implantação, online e offline, no nível da infraestrutura e da aplicação).
- Isolar núcleos individuais nos escalonadores, ou achar tarefas que evitem uma unidade defeituosa.
- Mitigar em software: verificações fim a fim, checkpoints para repetir em outro núcleo, invariantes da aplicação, computação dupla, redundância modular tripla possivelmente inserida pelo compilador com ideias de replay determinístico, e bibliotecas de funções críticas.
- Mitigar em hardware: design-for-test, verificação contínua, projeto conservador, uma arquitetura de machine check repensada e melhor telemetria de CPU.
- Em aberto para quem não tem frota: máquinas com núcleos mercuriais cedidas como IaaS, simuladores que injetam CEEs, injetores de falhas, e CEEs em GPUs e outros aceleradores.
