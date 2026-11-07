---
title: "Oxbow: uma arquitetura coordenada para sistemas de arquivos de múltiplos componentes"
summary: O Oxbow divide um sistema de arquivos entre uma biblioteca em nível de usuário, um servidor confiável em nível de usuário, uma camada fina no kernel e um SSD computacional, de modo que as leituras usam o page cache do kernel, as escritas contornam o kernel e o journaling em segundo plano roda no dispositivo sem atrasar o fsync.
researchArea: Sistemas operacionais
keywords: sistemas de arquivos, armazenamento computacional, kernel bypass, split journaling, page cache, fsync
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

SSDs NVMe rápidos e SSDs computacionais (CSDs, discos com núcleos ARM próprios) dividiram a pilha de armazenamento em três campos. Sistemas de arquivos de kernel como o Ext4 têm serviços ricos, mas pagam pelo caminho de I/O do kernel e ficam limitados pela CPU. Sistemas de arquivos em nível de usuário, como o µFS, pulam o kernel e perdem o page cache, o readahead, a proteção e chamadas zero-copy como `sendfile()`. Sistemas de arquivos dentro do dispositivo economizam CPU do host, mas sofrem com a latência do PCIe e com processadores fracos no dispositivo.

Este artigo do OSDI 2026, da University of Illinois Urbana-Champaign e do KAIST, argumenta que a escolha excludente é o problema. O Oxbow coloca cada operação onde ela rende mais, mirando quatro objetivos ao mesmo tempo: alto desempenho, interoperabilidade com o kernel, baixo uso de CPU do host e desenvolvimento rápido.

Vale separar quatro nomes: oxLib é a biblioteca de cada aplicação, H-Server é o servidor de arquivos confiável em nível de usuário que é dono do dispositivo, illuFS é a camada fina no kernel que se encaixa no VFS, e D-Server roda no CSD e faz o journaling em segundo plano. O Split Journaling é o mecanismo que amarra o host e o dispositivo.

Vale conhecer antes: o page cache e o `mmap`, o que o `fsync` promete, journaling de dados versus de metadados (como no JBD2 do Ext4) e drivers de armazenamento em nível de usuário como o SPDK. O [Snap](/papers/snap-microkernel-approach-to-host-networking) aplica essa mesma ideia de tirar serviços do kernel à rede do host, e o Oxbow o cita como exemplo em nível de usuário.

## Contribuição

- **Arquitetura coordenada.** As operações em primeiro plano ficam no host para evitar viagens de ida e volta pelo PCIe, o kernel mantém cache, proteção e compartilhamento, e o dispositivo recebe só o trabalho em segundo plano que tolera latência (journaling, checkpointing e, em princípio, garbage collection ou compressão).
- **I/O semi-kernel-bypass.** A oxLib transforma leituras e escritas em loads e stores sobre arquivos mapeados com `mmap`. Uma leitura causa um page fault no kernel, o illuFS pede ao H-Server que preencha o page cache, e o readahead do kernel funciona sem alterações. As escritas fazem store no page cache sem chamada de sistema, e o `fsync` vai direto ao H-Server, que escreve por um driver em nível de usuário.
- **Metadados com propriedade compartilhada.** Os campos do inode são divididos em pequenos grupos, cada um com um único escritor: a oxLib é dona de tamanho e timestamps, o kernel é dono de uid, gid e modo, e o H-Server só lê. Eles ficam em memória compartilhada, mapeada como somente leitura onde o componente não é dono, e a oxLib é tratada como não confiável. A oxLib também mantém bitmaps por arquivo de páginas sujas e de locks de página, então o H-Server encontra as páginas sujas e evita corridas com quem escreve.
- **Split Journaling.** Um fsync grava os dados e o inode do arquivo em uma área de staging persistente no host e retorna, sem esperar o journal. Os commits em segundo plano agrupam muitos arquivos, com o D-Server puxando um buffer DMA contíguo para a memória do dispositivo e gravando o journal. Cada transação de staging é autocontida, então nenhuma dependência de ordem liga o fsync aos commits em segundo plano. O buffer DMA serve também de cópia sombra, então quem escreve só bloqueia enquanto as páginas são copiadas.
- **Consistência após falhas.** O invariante é que todo arquivo que passou por fsync é recuperável a partir de sua transação de staging mais o prefixo do journal que ela registra. Os componentes são fail-stop, o H-Server pode simplesmente ser relançado após uma falha no lado do host, e o D-Server pode rodar no host se a capacidade de computação do CSD se perder.

## Metodologia

Os autores implementam o Oxbow em 53K linhas de C/C++, sem contar o lwext4, que fornece a lógica estilo Ext4 do H-Server com o journaling próprio desativado. O illuFS tem como alvo o kernel Linux 6.2. Nenhum CSD real foi usado: ele é emulado com uma DPU NVIDIA BlueField-2 (oito núcleos ARM de 2,0 GHz, 16 GB de DRAM) e um SSD Samsung PM1735 que suporta SR-IOV e compartilhamento de namespace, com a DPU alcançando o SSD por NVMe-oF. O host é um servidor dual-socket com Xeon Gold 5218 e 128 GB de DRAM.

As bases de comparação são o Ext4 em modo de journaling de dados, o µFS em seu modo zero-copy e o OmniCache, que os autores estenderam para rodar sobre um dispositivo em vez de memória persistente. A avaliação usa os microbenchmarks do µFS para latência, throughput, uso de CPU e operações de metadados, uma ablação com três variantes (journaling no host, sem staging, sem journaling em segundo plano) e quatro aplicações: LevelDB com YCSB, um benchmark de recuperação para RAG, checkpointing de LLM e Nginx com `sendfile`.

## Resultados

Estes são os resultados relatados pelos autores.

- **Latência de escrita (um fsync após cada escrita).** O Oxbow tem latência de 2,1× a 3,5× menor que o Ext4 em appends, de 1,2× a 1,8× em escritas sequenciais e de 1,2× a 1,9× em escritas aleatórias. O µFS chega a ser 43% mais rápido, o que os autores atribuem às duas cópias de memória extras do Oxbow.
- **Latência de leitura.** Com I/O de 4KB, as leituras sequenciais têm latência 18,2× menor que a do µFS graças ao readahead, e as leituras aleatórias são 5,5× menores que as do Ext4 e 7,7× menores que as do µFS. O Ext4 ainda supera o Oxbow em leituras sequenciais por 3% a 29%.
- **Throughput de escrita.** Até 86% acima do µFS, e 2,7× a 4,6×, 1,4× a 4,5× e 1,3× a 4,8× o do Ext4 em appends, escritas sequenciais e aleatórias. Os autores atribuem isso a transações com granularidade de arquivo, frente à contenção do JBD2.
- **Tempo de fsync.** Com um cliente, ele é de 16,8× a 19,2× menor que o do segundo melhor sistema, mas com 10 clientes a diferença cai para 2,0× a 2,2× conforme a banda satura.
- **Throughput de leitura.** As leituras sequenciais chegam a 10,5× a 18,5× o µFS, mas ficam de 0,2% a 24% abaixo do Ext4 até a janela de readahead crescer de 32 para 128 páginas, e depois disso o Oxbow vence em todos os casos. As leituras aleatórias têm o maior throughput entre todos os sistemas.
- **CPU do host.** Bytes por ciclo de CPU em escritas ficam em 1,8× a 3,9× o µFS e 1,3× a 4,7× o Ext4, e o artigo relata até 55% menos CPU do host que o µFS. A thread de journaling em segundo plano usa cerca de 0,1 núcleo. A eficiência cai conforme os clientes crescem, porque rajadas de fsync deixam menos trabalho para descarregar.
- **Ablação.** Journaling no host custa até 21% de throughput e até 44% mais CPU do host. Sem staging, a latência é cerca de 7,8× maior. Sem journaling em segundo plano, o throughput é até 33% menor e o tempo de fsync até 8,8× maior, embora ainda supere o Ext4.
- **Aplicações.** No YCSB, o Oxbow supera o µFS em 83% e 89% nas cargas B e C com um processo (34% e 37% com oito) e supera o Ext4 em 41% e 17% na E, mas fica 20% atrás do µFS na D com oito processos. As sondas do RAG têm latência de I/O 50% menor que a do Ext4 (até 45% menor na cauda), enquanto a latência ponta a ponta média é de 40 ms nos dois. O checkpointing de LLM ganha 58% de throughput e 46% menos latência sobre o Ext4, com o OmniCache logo atrás. O `sendfile` eleva o throughput do Nginx em 3,3×, contra 3,6× no Ext4.
- **Metadados (apêndice).** `stat` e `statall` escalam linearmente, chegando a 19× e 10× o µFS e a 57× e 30× o Ext4 com 10 clientes. `create` e `unlink` ficam atrás do Ext4, e `rename` escala 5,5× de 1 a 10 clientes.

## Análise crítica

O artigo não tem uma seção de limitações, mas o texto da avaliação admite vários custos.

- **Cópias extras nos dois caminhos.** As escritas copiam do buffer da aplicação para o page cache e de novo para um buffer do SPDK no fsync, e as leituras acrescentam duas trocas de contexto entre kernel e H-Server e uma cópia. O preço de reaproveitar o VFS aparece na latência de escrita frente ao µFS e nas leituras sequenciais frente ao Ext4.
- **Os ganhos da descarga diminuem sob carga.** A diferença no fsync cai de cerca de 17× para 2× conforme os clientes aumentam, e a eficiência cai. Operações de namespace como `create` e `unlink` passam pelo H-Server e pelo kernel e ficam atrás do Ext4.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **O CSD é emulado.** Uma DPU que alcança o SSD por NVMe-oF é um substituto razoável para a economia de CPU do host, como os autores argumentam, mas o throughput do journaling, o comportamento do DMA e as filas em um CSD real não são medidos. O artigo atribui as escritas aleatórias lentas do OmniCache a gargalos de CPU do CSD, mas o tempo de fsync de 20,8 s com um cliente (828× o do Oxbow) também mostra o quanto a adaptação de uma base de comparação pode pesar.
- **As bases de comparação são em geral conservadoras.** O µFS roda em modo zero-copy, seus ciclos de busy-wait entre cliente e servidor ficam fora da métrica de eficiência, e o Ext4 recebe um journal de 39 GB e um limite de checkpoint elevado para não travar. Isso favorece as bases, então os ganhos são críveis, mas vêm de uma máquina e um SSD, com o µFS limitado a 10 clientes.
- **Os números de destaque são melhores casos.** "Até 4,8×" e "até 55%" são máximos sobre cargas e números de clientes, enquanto os benchmarks de aplicação mostram ganhos menores (até 89% no YCSB e uma perda na carga D). No RAG, a latência ponta a ponta não muda, então o ganho de I/O não chega ao usuário ali.
- **A velocidade de desenvolvimento quase não é medida.** É um dos quatro objetivos, mas a evidência é a contagem de 53K linhas e a observação de que o `sendfile` funciona sem código extra. Não há comparação de esforço, e a interface plugável do H-Server é mostrada com uma única lógica (lwext4).
- **Consistência após falhas e segurança são argumentadas, não testadas.** O invariante e o procedimento de recuperação são descritos, mas não encontrei experimento de injeção de falhas, medição de tempo de recuperação nem número de amplificação de escrita, embora o journaling de dados com staging e checkpointing grave os dados mais de uma vez. O artigo também não discute o que uma oxLib não confiável que nunca libera um bit de lock de página faria com outros escritores ou com a cópia do H-Server no fsync.

## Pesquisas futuras

- Rodar em hardware de CSD real e descarregar outros trabalhos em segundo plano que o artigo cita, como garbage collection e compressão, ou mirar SSDs ZNS, FDP e CXL.
- Outras lógicas de sistema de arquivos atrás da interface plugável do H-Server, que o artefato pretende suportar, além do layout estilo Ext4 vindo do lwext4.
- Eliminar as cópias extras nos caminhos de leitura e escrita e adotar o prefetch de diretórios no `opendir` ao estilo do µFS, que o artigo diz que o Oxbow também poderia adotar.
- Testes com injeção de falhas e tempos de recuperação, e defesas contra uma oxLib que se comporte mal segurando locks, medidos sob carga multi-tenant.
