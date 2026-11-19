---
title: "O sistema de tempo compartilhado UNIX"
summary: Ritchie e Thompson descrevem o UNIX nos PDP-11/40 e 11/45, um sistema pequeno, interativo e que roda o próprio desenvolvimento, construído em torno de uma abstração uniforme de arquivo (arquivos comuns, diretórios e arquivos especiais), i-nodes, fork, exec, pipes e um Shell em nível de usuário.
researchArea: Sistemas operacionais
keywords: unix, tempo compartilhado, sistema de arquivos, i-node, fork e exec, pipes, shell, pdp-11
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

O UNIX é um sistema operacional de propósito geral, multiusuário e interativo para os computadores PDP-11/40 e 11/45 da Digital Equipment Corporation. Ele oferece vários recursos raramente encontrados mesmo em sistemas operacionais maiores, entre eles: (1) um sistema de arquivos hierárquico que incorpora volumes desmontáveis; (2) E/S compatível entre arquivos, dispositivos e processos; (3) a capacidade de iniciar processos assíncronos; (4) uma linguagem de comandos do sistema selecionável por usuário; e (5) mais de 100 subsistemas, incluindo uma dúzia de linguagens. Este artigo trata da natureza e da implementação do sistema de arquivos e da interface de comandos do usuário.

## Visão geral

Este é o artigo de 1974 na Communications of the ACM, de Dennis Ritchie e Ken Thompson, dos Bell Laboratories, uma versão revisada da palestra que fizeram no Quarto Simpósio da ACM sobre Princípios de Sistemas Operacionais (outubro de 1973). É a primeira descrição pública do UNIX e é curto: a interface que ele apresenta (open, read, write, fork, exec, pipe e o Shell) continua reconhecível em todo sistema tipo Unix de hoje.

O artigo trata só da versão para PDP-11. Os autores dizem que houve três versões do UNIX: uma para o PDP-7 e o PDP-9 (por volta de 1969 a 1970), uma para o PDP-11/20 sem proteção de memória, e a descrita aqui, para o PDP-11/40 e /45. Na época da escrita existiam cerca de 40 instalações, em geral menores que a dos autores, usadas para tarefas como preparar pedidos de patente e processar dados de falhas de centrais de comutação do Bell System.

Vale conhecer antes: o que são sistema de arquivos, processo e chamada de sistema, e como funciona um interpretador de linha de comando. Várias ideias daqui reaparecem em artigos do catálogo que repensam uma camada deste projeto: o [μFork](/papers/ufork-posix-fork-within-a-single-address-space-os) trata do custo do `fork` num sistema operacional sem espaços de endereçamento separados, e o [Oxbow](/papers/oxbow-coordinated-architecture-for-multi-component-file-systems) e o [Trio](/papers/trio-high-performance-and-secure-userspace-nvm-file-systems) perguntam onde o código do sistema de arquivos deve rodar. Esses pareamentos são meus, o artigo de 1974 não pode citá-los.

## Contribuição

- **Uma abstração de arquivo para três coisas.** Há arquivos comuns (uma sequência de bytes sem estrutura, com a estrutura a cargo dos programas que os usam), diretórios e arquivos especiais. Cada dispositivo de E/S tem pelo menos um arquivo especial, no diretório `/dev`, lido e escrito como um arquivo de disco, de modo que nomes de dispositivo e de arquivo têm a mesma sintaxe e a mesma proteção.
- **Diretórios em árvore, com links.** Um caminho é uma sequência de nomes separados por barras, e cada nome tem 14 caracteres ou menos. O mesmo arquivo pode aparecer em vários diretórios (um link) e todos os links têm status igual, então o arquivo existe independentemente de qualquer entrada de diretório. Os diretórios formam uma árvore com raiz, com as entradas `.` e `..`.
- **I-nodes.** Uma entrada de diretório guarda só um nome e um i-number, índice na i-list armazenada no dispositivo. O i-node guarda dono, bits de proteção, endereços dos blocos, tamanho, hora da última modificação, contagem de links e bits de diretório, arquivo especial e arquivo grande.
- **Processos com fork, exec, wait e exit.** Um processo novo só nasce de `fork`, que divide o chamador em duas cópias que compartilham os arquivos abertos. `execute` substitui código e dados do processo chamador a partir de um arquivo, mantendo os arquivos abertos e o diretório corrente.
- **Pipes e E/S padrão.** Os programas começam com os descritores 0 e 1 abertos. O Shell os redireciona com `<` e `>` e liga comandos com `|` por meio de um pipe, de modo que o programa não precisa saber se lê um arquivo, um terminal ou outro programa.
- **Um Shell que é só um programa.** Ele lê uma linha, chama `fork`, o filho chama `execute` e o pai espera. Um comando terminado em `&` simplesmente não é esperado.
- **Proteção por ID de usuário e pelo bit set-user-ID.** Sete bits de proteção por arquivo, mais um super-usuário isento deles.

## Metodologia

É uma descrição de sistema, não um experimento. Os autores explicam a interface visível ao usuário (seção 3), sua implementação (seção 4), o modelo de processos (seção 5) e o Shell (seção 6), e depois acrescentam uma breve perspectiva sobre o projeto e uma seção de estatísticas da própria instalação. A única medição do sistema em si é uma rodada de tempo, a montagem de um programa de 7621 linhas, executada sozinha na máquina. A seção 9 traz números de uso da máquina de Murray Hill, um PDP-11/45 com 144K bytes, sem descrever como foram coletados.

## Resultados

Todos os números abaixo vêm do artigo.

- **Custo e tamanho.** O UNIX pode rodar em hardware que custa a partir de US$ 40.000, e menos de dois homens-ano foram gastos no software principal do sistema. No PDP-11/45 dos autores (palavras de 16 bits, 144K bytes de memória de núcleo) o UNIX ocupa 42K bytes, incluindo muitos drivers de dispositivo e folga generosa para buffers e tabelas. Um sistema mínimo capaz de rodar o software listado pode precisar de apenas 50K bytes de memória no total.
- **Reescrito em C.** O sistema foi reescrito de linguagem de montagem para C no verão de 1973. O novo sistema é cerca de um terço maior, o que os autores consideram aceitável porque é mais fácil de entender e modificar e traz multiprogramação e compartilhamento de código reentrante.
- **Layout dos arquivos.** O espaço em disco é dividido em blocos de 512 bytes. Cada i-node tem espaço para oito endereços de dispositivo. Um arquivo pequeno cabe em oito blocos ou menos. Num arquivo grande, cada um dos oito endereços aponta para um bloco indireto com 256 endereços, e o arquivo pode chegar a 8 x 256 x 512 = 1.048.576 (2 elevado a 20) bytes. O i-node de um arquivo especial guarda, em vez disso, um tipo de dispositivo e um número de subdispositivo. Abrir um arquivo converte o caminho em i-number percorrendo os diretórios. O diretório raiz tem i-number 1 em todo sistema de arquivos, e `mount` é uma tabela que substitui um arquivo comum pela raiz de um volume removível.
- **Links e a árvore.** Criar um link copia o i-number e incrementa a contagem de links. Apagar decrementa, e em zero os blocos são liberados e o i-node é desalocado. Nenhum link pode cruzar sistemas de arquivos, e na raiz de todo sistema de arquivos `..` refere-se ao próprio diretório. Os autores justificam a proibição de links para diretórios: seria difícil detectar quando a última ligação da raiz até um diretório foi cortada.
- **Consistência e um custo do projeto.** A verificação de consistência só precisa varrer a i-list linear, independente da hierarquia de diretórios. Mas, com links de status igual, não está claro quem paga pelo espaço de um arquivo; os autores dizem que a versão atual evita a questão por não cobrar taxa alguma.
- **Sem travas.** Não há travas visíveis ao usuário. Os autores argumentam que travas são desnecessárias, pois não têm grandes bancos de dados em um único arquivo, e insuficientes, pois um editor que trabalha sobre uma cópia as contorna.
- **Pipes são limitados.** O artigo diz que o pipe não é um mecanismo totalmente geral, porque precisa ser criado por um ancestral comum dos processos envolvidos. Um filho criado por fork herda os arquivos abertos do pai, e o Shell implementa `<` e `>` fechando o descritor 0 ou 1 e abrindo o arquivo indicado, já que se atribui o menor descritor livre.
- **Eficiência.** A montagem das 7621 linhas levou 35,9 segundos de relógio, 212 linhas por segundo: 63,5% na execução do montador, 16,5% de sobrecarga do sistema e 20,0% de espera de disco. Os autores se recusam a comparar com outros sistemas.
- **Uso.** 72 usuários, no máximo 14 simultâneos, 300 diretórios, 4400 arquivos, 34000 blocos de 512 bytes. Por dia: 1800 comandos, 4,3 horas de CPU, 70 horas de conexão, 30 usuários diferentes e 75 logins. O compilador C consumiu 15,7% do tempo de CPU dos comandos e o editor foi o comando mais usado, com 15,3% dos acessos.
- **Confiabilidade.** Ao longo de um ano num 11/45 de uma safra muito antiga: cerca de uma queda a cada dois dias (dois terços por problemas de hardware, como quedas de energia), maior período contínuo de cerca de duas semanas, tempo total em operação de cerca de 98% e um sistema de arquivos perdido (um disco de cinco).
- **Lições de projeto.** Os autores citam três influências: conveniência de programação por meio do uso interativo, restrições severas de tamanho e o sistema manter a si mesmo. Atribuem o `fork` ao sistema de tempo compartilhado de Berkeley e ao Multics a influência sobre as chamadas de E/S e sobre o Shell.

## Análise crítica

O artigo é um ensaio de projeto apoiado em uma medição de tempo e um registro de uso, então a maior parte das afirmações é argumentada, não medida.

- **Evidência escassa.** Os autores dizem que não vão interpretar os tempos nem compará-los com outros sistemas. A confiabilidade é declarada "muito mais subjetiva" e baseada em lembranças.
- **Escolhas simples com custo.** Sem travas, sem links entre sistemas de arquivos e sem cobrança de espaço em disco eram viáveis para um grupo de pesquisa de 72 usuários numa só máquina. O artigo não afirma que isso se sustentaria num ambiente grande ou hostil.
- **Proteção mínima.** As permissões são de leitura, escrita e execução só para o dono e os demais, e o bit set-user-ID só torna seguro um programa privilegiado se ele for escrito com cuidado, como os autores observam.
- **Literatura posterior (fora deste artigo).** O relato de Ritchie de 1984, "The Evolution of the Unix Time-sharing System" (AT&T Bell Laboratories Technical Journal 63(8)), acrescenta que os pipes surgiram em 1972, depois de o sistema PDP-11 estar funcionando, por insistência de M. D. McIlroy, e que no PDP-7 o `fork` custou 27 linhas de assembly. Ele sugere que `fork` e `exec` separados existem principalmente porque o fork era fácil de implementar, não por um princípio de projeto mais profundo. Baumann, Appavoo, Krieger e Roscoe, em "A fork() in the road" (HotOS 2019), argumentam que o `fork` foi um truque inteligente para as máquinas dos anos 1970 e hoje é um passivo.

## Pesquisas futuras

- Como o modelo de arquivos e processos escala: redes, muitos processadores, travas e consistência do sistema de arquivos após uma queda.
- Substituir ou estender o `fork`, por exemplo com criação de processos no estilo spawn ou com projetos de espaço de endereçamento único como o [μFork](/papers/ufork-posix-fork-within-a-single-address-space-os).
- Tirar o código do sistema de arquivos do kernel, como no [Oxbow](/papers/oxbow-coordinated-architecture-for-multi-component-file-systems) e no [Trio](/papers/trio-high-performance-and-secure-userspace-nvm-file-systems).
- Proteção mais forte que dono, demais e set-user-ID, e formas de tornar programas privilegiados mais seguros.
- Ler a história posterior: o artigo de Ritchie de 1984 para ver como o projeto surgiu e a literatura de Unix depois de 1974 para ver o que mudou.
