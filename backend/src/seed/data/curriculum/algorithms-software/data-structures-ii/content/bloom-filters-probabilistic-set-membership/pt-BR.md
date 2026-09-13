---
version: 1.0
updatedAt: 2026-09-13
title: Filtros de Bloom: Pertencimento a Conjunto Probabilístico
summary: Um array de bits de tamanho m mais k funções hash independentes, sem nenhuma chave armazenada, dá falsos positivos possíveis mas falsos negativos estruturalmente impossíveis, uma troca de espaço independente do tamanho das chaves.
---
## Objetivos de Aprendizagem

- Descrever a estrutura de um filtro de Bloom: um array de bits de tamanho m, mais k funções hash independentes, sem que nenhuma chave seja de fato armazenada.
- Implementar precisamente a operação de inserção (definir k bits como 1) e o teste de pertencimento (verificar se todos os k bits são 1).
- Explicar por que um filtro de Bloom pode produzir falsos positivos mas nunca pode produzir um falso negativo, e derivar essa garantia diretamente da mecânica de inserção e consulta.
- Explicar por que filtros de Bloom padrão não suportam remoção, e identificar a troca (tamanho do array de bits versus taxa de falso positivo) que essa estrutura torna explícita.
- Identificar casos de uso realistas em que um falso positivo ocasional é um custo aceitável por economias dramáticas de memória.

## Contexto e Motivação

Toda estrutura baseada em hash coberta até agora nesta disciplina, hashing comum, hashing universal e hashing perfeito, compartilha um compromisso: todas de fato armazenam as chaves (ou pelo menos informação suficiente para recuperá-las), de forma que uma busca possa responder "essa chave está presente" com certeza total. Essa certeza tem um custo, armazenar n chaves ocupa espaço proporcional a n (e, para uma tabela hash, tipicamente um tanto mais que n uma vez contabilizada a folga de fator de carga). Para algumas cargas de trabalho reais, uma verificação de pertencimento a conjunto enorme acontece muito mais frequentemente que uma recuperação de fato, e uma pequena chance bem compreendida de erro seria um preço inteiramente aceitável por uma redução dramática de memória: um crawler web verificando "eu já visitei essa URL" contra bilhões de URLs, um banco de dados verificando "essa chave pode existir em disco antes de pagar por uma leitura de disco cara," ou um corretor ortográfico verificando "essa é uma palavra real" contra um dicionário grande. Burton Bloom introduziu exatamente essa troca em 1970: uma estrutura que responde consultas de pertencimento usando uma quantidade pequena e fixa de memória, independente de quão grandes ou complexas as próprias chaves sejam, abrindo mão de certeza perfeita em uma direção específica e cuidadosamente limitada.

## Teoria Central

### A estrutura: um array de bits e k funções hash, nada mais

Um **filtro de Bloom** consiste em um array de bits de `m` bits, inicializado inteiramente com 0, e `k` funções hash independentes `h_1, h_2, ..., h_k`, cada uma mapeando qualquer chave possível para um índice em `{0, 1, ..., m-1}`. Essa é a estrutura inteira. Crucialmente, nenhuma chave é jamais armazenada em nenhum lugar, apenas bits são definidos, que é exatamente o que torna a pegada de memória independente do tamanho ou complexidade das próprias chaves: um filtro de Bloom para um conjunto de URLs longas ocupa exatamente o mesmo espaço que um para um conjunto de caracteres únicos, dado o mesmo `m` e `k`.

### Inserção: definir k bits

Para inserir uma chave `x`, calcule todos os `k` valores de hash `h_1(x), h_2(x), ..., h_k(x)`, e defina o bit em cada uma dessas `k` posições no array como 1 (se um bit já é 1, dessa ou de uma inserção anterior, ele simplesmente permanece 1, nada é desfeito ou sobrescrito).

### Consulta de pertencimento: verificar k bits

Para testar se uma chave `x` pode estar no conjunto, calcule os mesmos `k` valores de hash, e verifique se *cada uma* dessas `k` posições atualmente contém 1. Se mesmo uma única delas for 0, a resposta é um certo **"definitivamente não está no conjunto"** (explicado abaixo). Se todas as `k` são 1, a resposta é **"possivelmente no conjunto"**, não uma certeza.

### Por que falsos negativos são impossíveis

Essa assimetria (um "não" confiante, um "sim" incerto) decorre diretamente de como a inserção funciona. Se `x` foi genuinamente inserido em algum momento, todos os seus `k` bits foram definidos como 1 naquele momento, e bits, uma vez definidos, nunca são limpos por nenhuma inserção posterior de uma chave *diferente*, apenas definidos (uma inserção só pode transformar um 0 em 1, nunca um 1 de volta em 0). Então, se `x` já foi inserido alguma vez, todos os seus `k` bits estão garantidamente ainda em 1 no momento da consulta, não importa o que mais tenha acontecido desde então, e a consulta é garantida a responder "possivelmente no conjunto". Um **falso negativo**, o filtro afirmando que uma chave está ausente quando na verdade foi inserida, é portanto estruturalmente impossível: exigiria que algum bit que foi definido como 1 no momento da inserção tivesse voltado a 0, uma operação que a estrutura nunca realiza.

### Por que falsos positivos são possíveis

A direção reversa não tem tal garantia. É inteiramente possível que uma chave `y` que *nunca* foi inserida tenha todas as suas `k` posições de hash já definidas como 1, puramente porque *outras* chaves, genuinamente inseridas, aconteceram de definir essas mesmas posições de bit ao longo do caminho. Quando isso acontece, consultar `y` incorretamente relata "possivelmente no conjunto", um **falso positivo**: o array de bits não consegue distinguir "esses bits são 1 porque y em si foi inserido" de "esses bits são 1 puramente por causa de sobreposição coincidente com posições de bit de outras chaves", já que nenhuma identidade de chave é jamais registrada, apenas bits. Essa possibilidade não é um bug a ser corrigido, é o preço específico e quantificável que um filtro de Bloom cobra por sua extrema eficiência de espaço, e o próximo conceito deriva exatamente quão grande esse preço é e como controlá-lo.

### Por que remoção não é suportada (na versão padrão)

Remover uma chave de forma ingênua significaria limpar seus `k` bits de volta para 0, mas isso é inseguro em geral: qualquer uma dessas `k` posições de bit também pode ter sido definida pela inserção de alguma outra chave ainda presente (já que muitas chaves podem compartilhar uma posição de hash, esse é exatamente o mecanismo por trás de falsos positivos), então limpar um bit poderia silenciosamente transformar uma chave atualmente presente em um falso negativo para uma chave totalmente não relacionada, violando a única garantia (nenhum falso negativo) que a estrutura é especificamente construída para nunca violar. O filtro de Bloom padrão, portanto, suporta apenas inserção e consulta, não remoção; uma variante chamada **filtro de Bloom contável** (usando pequenos contadores em vez de bits únicos, decrementando em vez de limpar na remoção) existe especificamente para adicionar suporte a remoção de volta, ao custo de memória adicional por slot, mas isso está além do que este conceito precisa estabelecer.

## Exemplos Resolvidos

### Exemplo 1: rastreando inserção e consulta em um filtro pequeno

**Problema:** Um filtro de Bloom tem `m = 10` bits (todos inicialmente 0) e `k = 2` funções hash. Insira `"gato"` (com `h_1("gato") = 1`, `h_2("gato") = 4`) e `"cachorro"` (com `h_1("cachorro") = 4`, `h_2("cachorro") = 7`). Depois consulte `"gato"`, `"cachorro"`, e `"pássaro"` (com `h_1("pássaro") = 1`, `h_2("pássaro") = 7`).

**Depois de ambas as inserções:** Os bits 1, 4 (de "gato"), e 4, 7 (de "cachorro") são definidos como 1. O array, índices 0 a 9, fica: `0 1 0 0 1 0 0 1 0 0`.

**Consulta "gato":** Verifique os bits 1 e 4: ambos são 1, então a resposta é "possivelmente no conjunto", corretamente (ele de fato foi inserido).

**Consulta "cachorro":** Verifique os bits 4 e 7: ambos são 1, então a resposta é "possivelmente no conjunto", corretamente.

**Consulta "pássaro":** Verifique os bits 1 e 7: ambos acontecem de ser 1 (o bit 1 foi definido por "gato", o bit 7 foi definido por "cachorro"), então a resposta é "possivelmente no conjunto", mesmo que "pássaro" nunca tenha sido inserido: um **falso positivo**, surgindo puramente da sobreposição coincidente das posições de hash de "pássaro" com bits que duas chaves inteiramente diferentes aconteceram de definir.

### Exemplo 2: confirmando que nenhum falso negativo é possível, mesmo depois de muitas inserções

**Problema:** Depois de inserir mais 1.000 chaves não relacionadas no filtro do Exemplo 1 (nenhuma delas "gato"), consulte "gato" novamente. Argumente por que a resposta ainda deve corretamente relatar "possivelmente no conjunto".

**Argumento:** Cada uma dessas 1.000 inserções só pode definir bits como 1 (nunca limpar um bit de volta para 0), então os bits 1 e 4 (definidos quando "gato" foi originalmente inserido) permanecem 1 independentemente do que mais tenha acontecido ao array desde então. Consultar "gato" novamente verifica as mesmas duas posições, encontra ambas ainda em 1, e corretamente relata "possivelmente no conjunto". Nenhuma quantidade de atividade subsequente em um filtro de Bloom jamais pode transformar um verdadeiro positivo em um falso negativo, exatamente a garantia que a Teoria Central deriva estruturalmente do fato de que a inserção nunca limpa um bit.

## Equívocos Comuns e Armadilhas

- **"Um filtro de Bloom pode dizer que uma chave está definitivamente presente."** Ele nunca pode fazer isso: mesmo uma consulta que retorna "possivelmente no conjunto" carrega alguma chance de ser um falso positivo (a consulta "pássaro" do Exemplo 1 mostra isso concretamente); a única resposta certa que um filtro de Bloom sempre dá é "definitivamente não está no conjunto".
- **"Filtros de Bloom armazenam as chaves em uma forma comprimida."** Nenhuma chave é jamais armazenada, de forma comprimida ou não, apenas posições de bit calculadas a partir de funções hash são definidas; é exatamente por isso que o custo de espaço é independente do tamanho ou complexidade da chave, e exatamente por isso que chaves individuais não podem ser recuperadas ou enumeradas a partir do filtro depois.
- **"Você pode remover uma chave de um filtro de Bloom limpando seus k bits."** O Exemplo 1 mostra que posições de bit são rotineiramente compartilhadas entre chaves diferentes ("gato" e "cachorro" ambos tocam o bit 4); limpar um bit compartilhado para remover uma chave transformaria incorretamente uma chave diferente, ainda presente, em um falso negativo, violando a única garantia absoluta do filtro. Remoção exige uma variante diferente (um filtro de Bloom contável) construída especificamente para suportá-la com segurança.
- **"Uma taxa de falso positivo significa que a estrutura não é confiável e não deveria ser usada para nada importante."** A taxa de falso positivo é uma quantidade conhecida e precisamente calculável (o próximo conceito deriva a fórmula exata), não um defeito imprevisível, e é ajustável escolhendo `m` e `k` apropriadamente; sistemas como as verificações de URL maliciosa de navegadores web e as verificações de "essa chave pode existir em disco" de engines de armazenamento de banco de dados usam filtros de Bloom especificamente porque essa taxa conhecida e ajustável é aceitável em troca do espaço economizado.

## Resumo

Um filtro de Bloom responde consultas de pertencimento a conjunto usando apenas um array de bits de tamanho `m` e `k` funções hash independentes, nunca armazenando nenhuma chave diretamente. A inserção define `k` bits por chave; uma consulta verifica se todas as `k` posições de bit de uma chave estão atualmente em 1, respondendo "possivelmente no conjunto" se sim e "definitivamente não está no conjunto" caso contrário. Como a inserção só define bits (nunca os limpa), uma chave que foi de fato inserida sempre tem todos os seus bits ainda definidos no momento da consulta, tornando falsos negativos estruturalmente impossíveis, mas chaves que nunca foram inseridas ainda podem ter todas as suas posições de bit coincidentemente definidas por outras chaves, tornando falsos positivos possíveis e, ao contrário das colisões de uma tabela hash, um custo aceito e quantificável em vez de algo a eliminar. Essa assimetria, mais a incapacidade resultante de suportar remoção com segurança, é exatamente a troca que um filtro de Bloom faz por um uso de espaço independente do tamanho da chave e dramaticamente menor do que de fato armazenar as chaves. O próximo conceito deriva exatamente quão grande é essa taxa de falso positivo, como função de `m`, `k` e `n`, e como escolher `m` e `k` para atingir uma taxa alvo.

## Documentation Links

- [Bloom, B. H. (1970). "Space/Time Trade-offs in Hash Coding with Allowable Errors." Communications of the ACM.](https://dl.acm.org/doi/10.1145/362686.362692): paper
- [Sedgewick & Wayne - Algorithms Lectures (Princeton)](https://algs4.cs.princeton.edu/lectures/): doc
